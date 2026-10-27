"""Run PES1UG24AM387_Lab04_DML_Join.sql in an interactive mysql client (pty),
save real terminal screenshots per step, and build PES1UG24AM387_Lab04_DML_Join.pdf.

Usage: python3 build.py   (needs a running MySQL/MariaDB server, reportlab, Pillow)
"""
import os
import pty
import re
import select
import subprocess
import time
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
SQL = HERE / f"{SRN}_Lab04_DML_Join.sql"
SHOTS = HERE / "screenshots"
PROMPT_RE = re.compile(r"(\(PES1UG24AM387@[^)]*\) \[[^\]]*\]> |MariaDB \[[^\]]*\]> |mysql> )$")
MAX_LINES = 46
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 15)


def parse_steps():
    """[{'id', 'title', 'stmts'}] from '-- @step ID | title' markers."""
    steps, buf = [], []
    for line in SQL.read_text().splitlines():
        m = re.match(r"^-- @step (\S+) \| (.*)", line)
        if m:
            steps.append({"id": m.group(1), "title": m.group(2).strip(), "stmts": []})
            continue
        if line.startswith("--") or not line.strip() or not steps:
            continue
        if line.startswith("prompt "):
            steps[-1]["stmts"].append(line)
            continue
        buf.append(line)
        if line.rstrip().endswith(";"):
            steps[-1]["stmts"].append("\n".join(buf))
            buf = []
    return steps


def clean(raw):
    txt = raw.decode(errors="replace").replace("\r\n", "\n").replace("\r", "")
    txt = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", txt)
    txt = re.sub(r"Stage: \d+ of \d+ '[^']*'\s+[\d.]+% of stage done\s*", "", txt)
    return re.sub(r"[\x00-\x09\x0b-\x1f\x7f]", "", txt)


class Session:
    def __init__(self):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.execvp("mysql", ["mysql", "-u", "root"])
        self.read_until_prompt()

    def read_until_prompt(self, timeout=20):
        out = b""
        end = time.time() + timeout
        while time.time() < end:
            r, _, _ = select.select([self.fd], [], [], 0.2)
            if r:
                out += os.read(self.fd, 65536)
                if PROMPT_RE.search(clean(out)):
                    if not select.select([self.fd], [], [], 0.15)[0]:
                        return out
        return out

    def run(self, stmt):
        lines = stmt.split("\n")
        for ln in lines:
            os.write(self.fd, ln.encode() + b"\n")
            time.sleep(0.03)
        return self.read_until_prompt()


def render(lines, path):
    pad, ch = 14, 19
    cw = FONT.getbbox("M")[2]
    w = max(len(l) for l in lines)
    im = PILImage.new("RGB", (max(640, w * cw + 2 * pad), len(lines) * ch + 2 * pad + 26), "#0c0c0c")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width, 24], fill="#2b2b2b")
    d.text((pad, 4), f"MySQL command line client - {SRN}", font=FONT, fill="#bbbbbb")
    for i, l in enumerate(lines):
        d.text((pad, 26 + pad + i * ch), l, font=FONT, fill="#e6e6e6")
    im.save(path)


def capture(steps):
    subprocess.run(["mysql", "-u", "root", "-e", "DROP DATABASE IF EXISTS smart_hostel"], check=True)
    SHOTS.mkdir(exist_ok=True)
    for f in SHOTS.glob("*"):
        f.unlink()
    s = Session()
    pending = clean(s.run("")).split("\n")[-1]
    errors = []
    for step in steps:
        chunks, cur = [], []
        for stmt in step["stmts"]:
            parts = clean(s.run(stmt)).split("\n")
            block = (pending + parts[0]).split("\n") + parts[1:-1]
            pending = parts[-1]
            if any(l.startswith("ERROR") for l in block):
                errors.append((step["id"], block))
            if cur and len(cur) + len(block) > MAX_LINES:
                chunks.append(cur)
                cur = []
            cur += block
        chunks.append(cur + [pending])
        step["images"] = []
        for i, c in enumerate(chunks, 1):
            name = f"{step['id']}_{i:02d}.png"
            render(c, SHOTS / name)
            (SHOTS / name.replace(".png", ".txt")).write_text("\n".join(c))
            step["images"].append(name)
    os.write(s.fd, b"exit\n")
    return errors


def build_pdf(steps):
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], fontSize=16, spaceAfter=8)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12, spaceBefore=6, spaceAfter=4)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=10, leading=13)
    code = ParagraphStyle("c", parent=ss["Code"], fontSize=8.2, leading=10,
                          backColor="#f3f3f3", borderPadding=4, leftIndent=4)
    doc = SimpleDocTemplate(str(HERE / f"{SRN}_Lab04_DML_Join.pdf"), pagesize=A4,
                            leftMargin=1.5 * cm, rightMargin=1.5 * cm,
                            topMargin=1.4 * cm, bottomMargin=1.4 * cm,
                            title=f"{SRN} Lab04 DML Join")
    W, H = A4[0] - 3 * cm, A4[1] - 2.8 * cm

    def shot(name, max_h):
        img = Image(str(SHOTS / name))
        k = min(W / img.imageWidth, max_h / img.imageHeight, 0.62)
        img.drawWidth, img.drawHeight = img.imageWidth * k, img.imageHeight * k
        return img

    story = [Spacer(1, 3 * cm),
             Paragraph("Database Management Systems - Week 5", ss["Title"]),
             Paragraph("DML and Join SQL Queries", ss["Heading2"]),
             Paragraph("Smart Hostel Management System - A Case Study", ss["Heading3"]),
             Spacer(1, 1 * cm), Paragraph(f"<b>SRN:</b> {SRN}", body), Spacer(1, 0.3 * cm),
             Paragraph("Contents: (1) schema creation screenshots, (2) inserted data "
                       "screenshots, (3) Part A questions 1-10 and Part B questions 1-12, each "
                       f"with its SQL query and output. SQL file: {SRN}_Lab04_DML_Join.sql.", body)]
    sections = {"P": "Task 1 : Database Preparation - Schema creation",
                "D1": "Task 1 : Inserted data",
                "A1": "Task 2 : Part A - DML and Set Operations",
                "B1": "Task 3 : Part B - Join Queries"}
    for step in steps:
        sid = step["id"]
        if sid in sections:
            story += [PageBreak(), Paragraph(sections[sid], h1)]
        is_q = sid[0] in "AB"
        head = (f"{'Part A' if sid[0] == 'A' else 'Part B'} - Q{sid[1:]}. {escape(step['title'])}"
                if is_q else escape(step["title"]))
        block = [Paragraph(head, h2)]
        if is_q:
            block += [Paragraph("<b>SQL query:</b>", body),
                      Preformatted("\n\n".join(step["stmts"]), code), Spacer(1, 4),
                      Paragraph("<b>Output:</b>", body)]
        for i, name in enumerate(step["images"]):
            img = shot(name, H - (9 * cm if i == 0 else 1 * cm))
            if i == 0:
                story.append(KeepTogether(block + [img, Spacer(1, 8)]))
            else:
                story += [img, Spacer(1, 8)]
    doc.build(story)


if __name__ == "__main__":
    steps = parse_steps()
    errs = capture(steps)
    for sid, block in errs:
        print("ERROR in", sid, "\n".join(block))
    build_pdf(steps)
    print("steps:", len(steps), "errors:", len(errs))
