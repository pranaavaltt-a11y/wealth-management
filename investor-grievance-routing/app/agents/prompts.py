"""Prompts are versioned artifacts on disk (L2). Every model call records name, version and content hash."""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

PROMPTS_DIR = Path(os.getenv("PROMPTS_DIR", Path(__file__).resolve().parents[2] / "prompts"))


@dataclass(frozen=True)
class Prompt:
    name: str
    version: str
    text: str

    @property
    def sha(self) -> str:
        return hashlib.sha256(self.text.encode()).hexdigest()[:10]

    @property
    def ref(self) -> str:
        return f"{self.name}@{self.version}#{self.sha}"


@lru_cache(maxsize=32)
def load(name: str, version: str) -> Prompt:
    path = PROMPTS_DIR / name / f"{version}.txt"
    if not path.exists():  # a variant may only change some prompts; fall back to v1
        path = PROMPTS_DIR / name / "v1.txt"
        version = "v1"
    return Prompt(name, version, path.read_text())
