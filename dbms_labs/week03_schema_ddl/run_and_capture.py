"""Run PES1UG24AM387_DDL_Lab3.sql through an interactive mysql client (pty)
and save the real terminal transcript of every step as PNG screenshots.

Usage: python3 run_and_capture.py
"""
import json
import os
import pty
import re
import select
import subprocess
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
SQL = HERE / "PES1UG24AM387_DDL_Lab3.sql"
IMG = HERE / "screenshots"
PROMPT_RE = re.compile(rb"(\(PES1UG24AM387@[^)]*\)\[[^\]]*\]> |MariaDB \[[^\]]*\]> |mysql> )$")
MAX_LINES = 46
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 15)


def parse_steps():
    """Return [(step_id, title, [statement, ...]), ...]."""
    steps = [("0", "Set the mysql prompt", [])]
    buf = []
    for line in SQL.read_text().splitlines():
        m = re.match(r"^-- (2\.\d)\s+(.*)", line)
        if m:
            steps.append((m.group(1), m.group(2).strip(), []))
            continue
        if line.startswith("--") or not line.strip():
            continue
        if line.startswith("prompt "):
            steps[-1][2].append(line)
            continue
        buf.append(line)
        if line.rstrip().endswith(";"):
            steps[-1][2].append("\n".join(buf))
            buf = []
    return steps


class Session:
    def __init__(self):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.environ["COLUMNS"] = "200"
            os.execvp("mysql", ["mysql", "-u", "root"])
        self.read_until_prompt()

    def read_until_prompt(self, timeout=20):
        out = b""
        end = time.time() + timeout
        while time.time() < end:
            r, _, _ = select.select([self.fd], [], [], 0.2)
            if r:
                chunk = os.read(self.fd, 65536)
                out += chunk
                if PROMPT_RE.search(out.replace(b"\r", b"")):
                    # make sure nothing else is pending
                    r2, _, _ = select.select([self.fd], [], [], 0.15)
                    if not r2:
                        return out
        return out

    def run(self, stmt):
        # send line by line so the client draws its "->" continuation prompts
        lines = stmt.split("\n")
        for ln in lines[:-1]:
            os.write(self.fd, ln.encode() + b"\n")
            time.sleep(0.03)
        os.write(self.fd, lines[-1].encode() + b"\n")
        return self.read_until_prompt()


def clean(raw):
    txt = raw.decode(errors="replace").replace("\r\n", "\n").replace("\r", "")
    txt = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", txt)
    # progress line the client redraws in place on a real terminal
    txt = re.sub(r"Stage: \d+ of \d+ '[^']*'\s+[\d.]+% of stage done\s*", "", txt)
    return re.sub(r"[\x00-\x09\x0b-\x1f\x7f]", "", txt)


def render(lines, path):
    pad = 14
    w = max(len(l) for l in lines) if lines else 10
    cw, ch = FONT.getbbox("M")[2], 19
    im = Image.new("RGB", (max(640, w * cw + 2 * pad), len(lines) * ch + 2 * pad + 26), "#0c0c0c")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width, 24], fill="#2b2b2b")
    d.text((pad, 4), "MySQL command line client - PES1UG24AM387", font=FONT, fill="#bbbbbb")
    for i, l in enumerate(lines):
        d.text((pad, 26 + pad + i * ch), l, font=FONT, fill="#e6e6e6")
    im.save(path)


def main():
    subprocess.run(["mysql", "-u", "root", "-e", "DROP DATABASE IF EXISTS smart_hostel"], check=True)
    IMG.mkdir(exist_ok=True)
    for f in IMG.glob("*.png"):
        f.unlink()
    steps = parse_steps()
    s = Session()
    manifest = []
    pending_prompt = ""  # the prompt text that precedes the next command
    first = s.run("")  # get a clean prompt line
    pending_prompt = clean(first).split("\n")[-1]
    for sid, title, stmts in steps:
        chunks, cur = [], []
        for stmt in stmts:
            out = clean(s.run(stmt))
            parts = out.split("\n")
            new_prompt = parts[-1]
            block = (pending_prompt + parts[0]).split("\n") + parts[1:-1]
            pending_prompt = new_prompt
            if cur and len(cur) + len(block) > MAX_LINES:
                chunks.append(cur)
                cur = []
            cur += block
        if cur:
            chunks.append(cur + [pending_prompt])
        files = []
        for i, c in enumerate(chunks, 1):
            name = f"step_{sid.replace('.', '_')}_{i:02d}.png"
            render(c, IMG / name)
            files.append(name)
            (IMG / name.replace(".png", ".txt")).write_text("\n".join(c))
        manifest.append({"step": sid, "title": title, "images": files})
    os.write(s.fd, b"exit\n")
    (IMG / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
