"""Guardrails (L4): prompt-injection defence, toxicity detection, and output filtering.

Injection defence has three layers:
1. Detection on every free-text field before it reaches a model (pattern score below).
2. Spotlighting: free text is wrapped in <complaint> tags with any tag look-alikes removed, and every prompt
   tells the model that the content inside is data. Tool results are passed back as JSON data, the same way.
3. Containment: the model can only choose among read-only tools, and whatever it outputs passes the output
   filter. Injected text that does reach a model cannot change a route into one the system is not allowed
   to issue, and cannot produce a citation the verifier will accept.
A high-scoring injection is not sent to the research agent at all: the run is escalated to a human.
"""
from __future__ import annotations

import re

INJECTION_PATTERNS = [
    (r"\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instruction|prompt|rule|direction)s?", 0.9),
    (r"\b(system|developer)\s*(prompt|message|instruction)", 0.6),
    (r"\byou are now\b|\bact as\b|\bpretend to be\b|\broleplay\b", 0.5),
    (r"\b(respond|reply|answer|output)\s+(only\s+)?with\b", 0.4),
    (r"\"?(route|action|determination)\"?\s*[:=]\s*\"?(assign|refer|not_maintainable|escalate|final)", 0.8),
    (r"\b(mark|classify|route|assign)\b.{0,30}\b(as|to)\b.{0,30}\b(resolved|closed|maintainable|sebi|rbi)\b.{0,20}\b(regardless|anyway|immediately)", 0.6),
    (r"</?(system|assistant|user|complaint|tool)>", 0.7),
    (r"\b(call|invoke|use)\s+the\s+\w+\s+tool\b", 0.5),
    (r"\bbase64\b|[A-Za-z0-9+/]{120,}={0,2}", 0.4),
    (r"\bjailbreak\b|\bDAN\b|do anything now", 0.8),
]
INJECTION_THRESHOLD_FLAG = 0.4
INJECTION_THRESHOLD_BLOCK = 0.8

TOXIC_TERMS = [
    "idiot", "stupid", "moron", "bastard", "scum", "bloody fool", "useless fools", "go to hell", "damn you",
    "f***", "fuck", "shit", "bitch", "asshole",
]
THREAT_PATTERNS = [r"\b(kill|hurt|attack|burn|bomb|beat)\b.{0,25}\b(you|him|her|them|the (staff|officer|manager)|office)\b",
                   r"\bi will (come|find)\b.{0,40}\b(office|house|home)\b"]

FORBIDDEN_OUTPUT = [
    (r"\b(complaint|grievance|matter)\s+(is|has been|stands)\s+(closed|disposed|resolved|dismissed|rejected)\b", "disposal"),
    (r"\b(we|sebi|rbi|the system)\s+(have|has|will)\s+(resolved|closed|disposed|refunded|penali[sz]ed|ordered)\b", "disposal"),
    (r"\b(award|compensation of|refund of)\s+(rs\.?|inr|₹)\s*\d", "relief"),
    (r"\b(penalty|fine)\s+(is|has been)\s+imposed\b", "enforcement"),
    (r"\bguarantee[sd]?\b.{0,30}\b(refund|recovery|outcome)\b", "guarantee"),
]
ALLOWED_ROUTES = {"assign_to_entity", "refer_to_other_regulator", "not_maintainable", "escalate_to_human"}
ALLOWED_REGULATORS = {None, "SEBI", "RBI", "IRDAI", "PFRDA", "UNREGULATED", "STATE_GOVT"}


def injection_score(text: str) -> tuple[float, list[str]]:
    hits, weights = [], []
    for pattern, weight in INJECTION_PATTERNS:
        if re.search(pattern, text or "", re.I | re.S):
            hits.append(pattern[:40])
            weights.append(weight)
    score = min(1.0, max(weights) + 0.15 * (len(weights) - 1)) if weights else 0.0
    return round(score, 2), hits


def spotlight(text: str) -> str:
    cleaned = re.sub(r"</?\s*(system|assistant|user|complaint|tool)\s*>", "[tag removed]", text or "", flags=re.I)
    return f"<complaint>{cleaned}</complaint>"


def toxicity(text: str) -> tuple[float, list[str]]:
    low = (text or "").lower()
    hits = [t for t in TOXIC_TERMS if t in low]
    hits += [p[:30] for p in THREAT_PATTERNS if re.search(p, low)]
    score = min(1.0, 0.35 * len(hits) + (0.5 if any(re.search(p, low) for p in THREAT_PATTERNS) else 0))
    return round(score, 2), hits


def mask_toxic(text: str) -> str:
    out = text
    for term in TOXIC_TERMS:
        out = re.sub(re.escape(term), "*" * len(term), out, flags=re.I)
    return out


def filter_output(determination: dict) -> list[str]:
    """Return the list of violations; empty means the determination may be issued."""
    violations = []
    if determination.get("route") not in ALLOWED_ROUTES:
        violations.append(f"route {determination.get('route')!r} is not an allowed determination")
    if determination.get("regulator") not in ALLOWED_REGULATORS:
        violations.append(f"regulator {determination.get('regulator')!r} is not recognised")
    text = " ".join(str(determination.get(k) or "") for k in ("basis", "reason", "escalation_path", "timeline"))
    for pattern, label in FORBIDDEN_OUTPUT:
        if re.search(pattern, text, re.I):
            violations.append(f"output claims an unauthorised {label}")
    tox, _ = toxicity(text)
    if tox >= 0.35:
        violations.append("output failed the toxicity check")
    return violations
