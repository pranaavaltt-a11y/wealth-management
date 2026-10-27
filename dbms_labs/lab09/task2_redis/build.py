"""Run PES1UG24AM387_RedisLab.txt against a live Redis server, save terminal
screenshots per question, and build PES1UG24AM387_RedisLab.pdf.

Each command is run through redis-cli on a pseudo-terminal, so replies are printed
in redis-cli's interactive format ((integer) 3, (nil), 1) "..."), shown after the
redis-cli prompt. Usage: python3 build.py   (needs redis-server running, Pillow, reportlab)
"""
import os
import pty
import re
import shlex
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image as PILImage, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (Image, KeepTogether, PageBreak, Paragraph, Preformatted,
                                SimpleDocTemplate, Spacer)

HERE = Path(__file__).parent
SRN = "PES1UG24AM387"
CMDS = HERE / f"{SRN}_RedisLab.txt"
SHOTS = HERE / "screenshots"
PROMPT = "127.0.0.1:6379> "
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 15)

TITLES = {
    "Q1": "Daily quota", "Q2": "Start a chat", "Q3": "User profile", "Q4": "OTP and quota",
    "Q5": "Beta program", "Q6": "Leaderboard", "Q7": "Support ticket queue",
    "Q8": "Updating a profile", "Q9": "Leaderboard race", "Q10": "Pick the right type",
}
LEVEL = {**{q: "Easy" for q in ("Q1", "Q2")},
         **{q: "Medium" for q in ("Q3", "Q4", "Q5", "Q6")},
         **{q: "Hard" for q in ("Q7", "Q8", "Q9", "Q10")}}

ANSWERS = {
    "Q1": ["MSET stores both allowances in one command (reply OK).",
           "MGET returns them in the order asked: 1) \"20\" for quota:u1, 2) \"50\" for quota:u2."],
    "Q2": ["RPUSH appends both messages to the end in the order given, so \"Hello\" is first (reply 2 = new length).",
           "LPUSH places \"SYSTEM: be concise\" at the head without changing the order of the existing messages."],
    "Q3": ["HSET replies (integer) 3: three new fields were created.",
           "HINCRBY credits 50 performs the addition in Redis and replies 60, the new balance.",
           "HLEN replies 3: the profile has three fields."],
    "Q4": ["SET ... EX 120 stores the OTP and its 120-second expiry in one command.",
           "INCRBY quota:u1 -3 subtracts inside Redis and replies 17.",
           "APPEND replies (integer) 13: the new length in characters of status:u1, now \"Online (busy)\".",
           "MGET shows \"483920\", \"17\" and (nil) for quota:u99, because that key does not exist."],
    "Q5": ["SADD u2 u4 replies (integer) 1: only u4 is new; u2 was already a member and a set holds each member once.",
           "SCARD replies 4 (u1, u2, u3, u4); SREM u4 replies 1 (one member removed)."],
    "Q6": ["ZADD replies 3 (three new members); ZCARD replies 3.",
           "ZINCRBY 700 cara replies \"1000\" (300 + 700).",
           "Cara is #1 now with 1000 tokens, ahead of ben (800) and ava (500)."],
    "Q7": ["After RPUSH T1 T2 T3 and LPUSH URGENT-1 the queue is URGENT-1, T1, T2, T3.",
           "LPOP returns \"URGENT-1\" (the front ticket); RPOP returns \"T3\" (the back ticket).",
           "After RPUSH T4 T5 the queue is T1, T2, T4, T5; LTRIM 0 1 keeps T1 and T2."],
    "Q8": ["HINCRBY credits -30 replies 70; HINCRBY messages 1 creates the missing field from 0 and replies 1.",
           "HDEL plan replies 1; HEXISTS plan then replies 0 (absent).",
           "HLEN replies 3: name, credits and messages remain."],
    "Q9": ["ZADD replies 4; initial order (highest first): ben, dev, ava, cara.",
           "ZINCRBY 400 ava replies \"900\", so ava becomes the top player.",
           "ZREVRANK ava replies 0 (top); ZRANK cara replies 0 (lowest score, 300).",
           "After ZREM ben: ava 900, dev 600, cara 300."],
    "Q10": ["1. String - SET otp:u5 \"7781\" EX 60 (one value that expires).",
            "2. List - RPUSH conv:5 \"Hi\" (keeps arrival order; later messages go after it).",
            "3. Hash - HSET user:5 name \"Neha\" plan \"free\" (named fields under one key).",
            "4. Set - SADD beta:gpt-next u5 (unique members, no order).",
            "5. Sorted Set - ZADD leaderboard:tokens 250 u5 (members ordered by score).",
            "6. Running SADD beta:gpt-next u5 again returns (integer) 0: u5 is already a member, "
            "and a set never stores a duplicate, so nothing new was added. This is not an error.",
            "7. RPUSH user:5 \"hello\" fails with WRONGTYPE Operation against a key holding the wrong "
            "kind of value: user:5 is a Hash, and a key can hold only one type, so List commands "
            "cannot be used on it."],
}


def parse():
    """{'Q1': [lines...]} keeping comment lines inside a question; plus the session start."""
    blocks, cur = {"Start": []}, "Start"
    for line in CMDS.read_text().splitlines():
        m = re.match(r"^# (Q\d+)$", line)
        if m:
            cur = m.group(1)
            blocks[cur] = []
            continue
        if not line.strip() or (cur == "Start" and line.startswith("#")):
            continue
        blocks[cur].append(line)
    return blocks


def run(cmd):
    """Run one command through redis-cli on a pty; return its reply lines."""
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("redis-cli", ["redis-cli", *shlex.split(cmd)])
    out = b""
    while True:
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
    os.waitpid(pid, 0)
    txt = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", out.decode(errors="replace"))
    return txt.replace("\r", "").rstrip("\n").split("\n")


def render(lines, path):
    pad, ch = 14, 19
    cw = FONT.getbbox("M")[2]
    w = max(len(l) for l in lines)
    im = PILImage.new("RGB", (max(620, w * cw + 2 * pad), len(lines) * ch + 2 * pad + 26), "#0c0c0c")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width, 24], fill="#2b2b2b")
    d.text((pad, 4), f"redis-cli - {SRN}", font=FONT, fill="#bbbbbb")
    for i, l in enumerate(lines):
        color = "#ff6b6b" if "WRONGTYPE" in l else "#e6e6e6"
        d.text((pad, 26 + pad + i * ch), l, font=FONT, fill=color)
    im.save(path)


def capture(blocks):
    SHOTS.mkdir(exist_ok=True)
    for f in SHOTS.glob("*"):
        f.unlink()
    for q, lines in blocks.items():
        shot = []
        for cmd in lines:
            if cmd.startswith("#"):
                continue
            shot.append(PROMPT + cmd)
            shot += run(cmd)
        shot.append(PROMPT)
        render(shot, SHOTS / f"{q}.png")
        (SHOTS / f"{q}.txt").write_text("\n".join(shot))


def build_pdf(blocks):
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], fontSize=16)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=13, spaceBefore=4, spaceAfter=4)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=10, leading=13)
    code = ParagraphStyle("c", parent=ss["Code"], fontSize=8.5, leading=10.5,
                          backColor="#f3f3f3", borderPadding=4, leftIndent=4)
    doc = SimpleDocTemplate(str(HERE / f"{SRN}_RedisLab.pdf"), pagesize=A4,
                            leftMargin=1.6 * cm, rightMargin=1.6 * cm,
                            topMargin=1.4 * cm, bottomMargin=1.4 * cm, title=f"{SRN} Redis Lab")
    W, H = A4[0] - 3.2 * cm, A4[1] - 2.8 * cm

    def img(name, max_h):
        im = Image(str(SHOTS / name))
        k = min(W / im.imageWidth, max_h / im.imageHeight, 0.62)
        im.drawWidth, im.drawHeight = im.imageWidth * k, im.imageHeight * k
        return im

    story = [Spacer(1, 2.5 * cm),
             Paragraph("DBMS Lab 09 - Task 2: Key-Value Database (Redis)", ss["Title"]),
             Paragraph("PromptPal - An AI Chat Platform", ss["Heading2"]),
             Spacer(1, 0.6 * cm), Paragraph(f"<b>SRN:</b> {SRN}", body), Spacer(1, 0.3 * cm),
             Paragraph("Each question was run from an empty database (FLUSHDB, DBSIZE = 0) in "
                       "redis-cli; ECHO prints the SRN at the start of every screenshot. "
                       f"Complete command list: {SRN}_RedisLab.txt.", body),
             Spacer(1, 0.5 * cm), Paragraph("Session start", h2),
             Preformatted("\n".join(blocks["Start"]), code), Spacer(1, 4),
             img("Start.png", 6 * cm)]
    for q in [k for k in blocks if k != "Start"]:
        story.append(PageBreak())
        story.append(KeepTogether([
            Paragraph(f"{q}. {TITLES[q]}  ({LEVEL[q]})", h1),
            Paragraph("<b>Commands:</b>", body),
            Preformatted("\n".join(blocks[q]), code), Spacer(1, 6),
            Paragraph(f"<b>Screenshot - {q}:</b>", body),
            img(f"{q}.png", H - 11 * cm)]))
        story.append(Spacer(1, 6))
        story.append(Paragraph("<b>Replies explained:</b>", body))
        for a in ANSWERS[q]:
            story.append(Paragraph("&bull; " + escape(a), body))
    doc.build(story)


if __name__ == "__main__":
    b = parse()
    capture(b)
    build_pdf(b)
    print("built", len(b) - 1, "questions")
