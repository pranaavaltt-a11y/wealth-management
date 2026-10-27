"""Build PES1UG24AM387_Schema_Lab03.pdf: Task 1 relational schema + Task 2 screenshots.

Run run_and_capture.py first. Needs Graphviz `dot` and reportlab.
"""
import json
import subprocess
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (Image, KeepTogether, PageBreak, Paragraph,
                                SimpleDocTemplate, Spacer, Table, TableStyle)

HERE = Path(__file__).parent
SRN = "PES1UG24AM387"
SHOTS = HERE / "screenshots"

# relation -> (columns, pk columns, {fk column(s): "ref"})
SCHEMA = [
    ("HOSTEL", ["Hostel_ID", "Hostel_Name", "Location", "Capacity"], ["Hostel_ID"], {}),
    ("STAFF", ["Staff_ID", "Name", "Salary", "Designation", "Hostel_ID", "Supervisor_ID"],
     ["Staff_ID"], {"Hostel_ID": "HOSTEL(Hostel_ID)", "Supervisor_ID": "STAFF(Staff_ID)"}),
    ("ROOM", ["Hostel_ID", "Room_Number", "Floor"], ["Hostel_ID", "Room_Number"],
     {"Hostel_ID": "HOSTEL(Hostel_ID)"}),
    ("ROOM_BED", ["Hostel_ID", "Room_Number", "Bed_Number", "Availability"],
     ["Hostel_ID", "Room_Number", "Bed_Number"],
     {"(Hostel_ID, Room_Number)": "ROOM(Hostel_ID, Room_Number)"}),
    ("STUDENT", ["Student_ID", "First_Name", "Middle_Name", "Last_Name", "Gender",
                 "Date_of_Birth", "Email_Address"], ["Student_ID"], {}),
    ("STUDENT_PHONE", ["Student_ID", "Phone_Number"], ["Student_ID", "Phone_Number"],
     {"Student_ID": "STUDENT(Student_ID)"}),
    ("ALLOCATION", ["Student_ID", "Hostel_ID", "Room_Number", "Allocation_Date",
                    "Check_in_Date", "Check_out_Date"], ["Student_ID", "Hostel_ID", "Room_Number"],
     {"Student_ID": "STUDENT(Student_ID)",
      "(Hostel_ID, Room_Number)": "ROOM(Hostel_ID, Room_Number)"}),
    ("PAYMENT", ["Payment_ID", "Payment_Date", "Amount", "Payment_Type", "Student_ID"],
     ["Payment_ID"], {"Student_ID": "STUDENT(Student_ID)"}),
    ("RECEIPT", ["Receipt_ID", "Receipt_Date", "Payment_ID"], ["Receipt_ID"],
     {"Payment_ID": "PAYMENT(Payment_ID)  [UNIQUE, NOT NULL]"}),
    ("FACILITY", ["Facility_ID", "Facility_Name", "Operating_Hours", "Hostel_ID"],
     ["Facility_ID"], {"Hostel_ID": "HOSTEL(Hostel_ID)"}),
    ("FACILITY_USAGE", ["Student_ID", "Facility_ID"], ["Student_ID", "Facility_ID"],
     {"Student_ID": "STUDENT(Student_ID)", "Facility_ID": "FACILITY(Facility_ID)"}),
]

MAPPING = [
    ("Strong entities", "HOSTEL, STAFF, STUDENT, PAYMENT, RECEIPT, FACILITY each become a "
     "relation with their simple attributes; the key attribute becomes the primary key."),
    ("Weak entity ROOM (identifying relationship HAS)", "ROOM includes the owner's key "
     "Hostel_ID as a foreign key; PK = (Hostel_ID, Room_Number) = owner key + partial key."),
    ("Composite attribute Student_Name", "Only the simple components First_Name, Middle_Name, "
     "Last_Name are stored in STUDENT."),
    ("Derived attribute Age", "Not stored; computed from Date_of_Birth when queried."),
    ("Multivalued attribute Phone_Number", "New relation STUDENT_PHONE(Student_ID, Phone_Number), "
     "PK = both columns, FK to STUDENT."),
    ("Multivalued composite attribute Bed", "New relation ROOM_BED holding ROOM's full key plus "
     "Bed_Number and Availability; PK = (Hostel_ID, Room_Number, Bed_Number)."),
    ("1:N EMPLOYS, MAKES, PROVIDES", "Foreign key of the '1' side placed on the 'N' side "
     "(STAFF.Hostel_ID, PAYMENT.Student_ID, FACILITY.Hostel_ID). Total participation of the "
     "N side gives NOT NULL."),
    ("1:N recursive SUPERVISES", "STAFF.Supervisor_ID references STAFF(Staff_ID); nullable "
     "because a senior staff member has no supervisor (partial participation)."),
    ("1:1 GENERATES", "FK Payment_ID placed in RECEIPT (a receipt cannot exist without its "
     "payment), declared NOT NULL and UNIQUE so each payment has at most one receipt."),
    ("M:N ALLOCATES", "New relation ALLOCATION with the keys of STUDENT and ROOM as FKs; "
     "PK = (Student_ID, Hostel_ID, Room_Number). The relationship attributes Allocation_Date, "
     "Check_in_Date, Check_out_Date are placed here."),
    ("M:N USES", "New relation FACILITY_USAGE(Student_ID, Facility_ID), PK = both FKs."),
]

STEP_NOTES = {
    "0": "Prompt set to (SRN@\\U)[\\d]> as required before executing any command.",
    "2.1": "Database smart_hostel and all 11 tables created with named PK, UNIQUE, CHECK, "
           "NOT NULL, DEFAULT and FK constraints (each FK with one referential action), followed "
           "by SHOW TABLES, DESC of every table and the list of named constraints. "
           "Note: MySQL/MariaDB always store the primary key under the name PRIMARY, so the "
           "warning 'Name pk_... ignored for PRIMARY key' is expected.",
    "2.2": "New first column Facility_Status with DEFAULT 'Active' added to FACILITY.",
    "2.3": "The recursive SUPERVISES foreign key (fk_staff_supervisor, ON DELETE SET NULL) was "
           "left out of CREATE TABLE and is added with ALTER TABLE. The listing shows the "
           "referential action of every FK.",
    "2.4": "Designation renamed to Position in STAFF.",
    "2.5": "Gender changed from CHAR(1) to ENUM('M','F','O').",
    "2.6": "Column Position dropped from STAFF.",
    "2.7": "Email_Address widened from VARCHAR(50) to VARCHAR(100).",
    "2.8": "Table student renamed to students (FKs referring to it follow automatically).",
    "2.9": "FACILITY_USAGE dropped after first dropping its constraints "
           "(fk_usage_student, fk_usage_facility and its primary key).",
}


def schema_diagram():
    rows = []
    for name, cols, pk, fks in SCHEMA:
        fk_cols = set()
        for k in fks:
            fk_cols |= set(k.strip("()").replace(" ", "").split(","))
        cells = []
        for c in cols:
            txt = f"<U>{c}</U>" if c in pk else c
            if c in fk_cols:
                txt += ' <FONT COLOR="#b03030">(FK)</FONT>'
            cells.append(f'<TD PORT="{c}" ALIGN="LEFT">{txt}</TD>')
        rows.append(
            f'  {name} [label=<<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4">'
            f'<TR><TD BGCOLOR="#1f4e79"><FONT COLOR="white"><B>{name}</B></FONT></TD></TR>'
            + "".join(f"<TR>{c}</TR>" for c in cells) + "</TABLE>>];")
    edges = [
        ("STAFF", "Hostel_ID", "HOSTEL", "Hostel_ID"),
        ("STAFF", "Supervisor_ID", "STAFF", "Staff_ID"),
        ("ROOM", "Hostel_ID", "HOSTEL", "Hostel_ID"),
        ("ROOM_BED", "Room_Number", "ROOM", "Room_Number"),
        ("STUDENT_PHONE", "Student_ID", "STUDENT", "Student_ID"),
        ("ALLOCATION", "Student_ID", "STUDENT", "Student_ID"),
        ("ALLOCATION", "Room_Number", "ROOM", "Room_Number"),
        ("PAYMENT", "Student_ID", "STUDENT", "Student_ID"),
        ("RECEIPT", "Payment_ID", "PAYMENT", "Payment_ID"),
        ("FACILITY", "Hostel_ID", "HOSTEL", "Hostel_ID"),
        ("FACILITY_USAGE", "Student_ID", "STUDENT", "Student_ID"),
        ("FACILITY_USAGE", "Facility_ID", "FACILITY", "Facility_ID"),
    ]
    dot = ["digraph R {", '  graph [rankdir=RL nodesep=0.35 ranksep=0.9 fontname="Helvetica"];',
           '  node [shape=plaintext fontname="Helvetica" fontsize=11];',
           '  edge [color="#555555" arrowsize=0.7];'] + rows
    for a, ac, b, bc in edges:
        dot.append(f"  {a}:{ac} -> {b}:{bc};")
    dot.append("}")
    src = HERE / f"{SRN}_RelationalSchema_Lab03.dot"
    src.write_text("\n".join(dot))
    png = HERE / f"{SRN}_RelationalSchema_Lab03.png"
    subprocess.run(["dot", "-Tpng", "-Gdpi=170", str(src), "-o", str(png)], check=True)
    return png


def fit_image(path, max_w, max_h):
    img = Image(str(path))
    scale = min(max_w / img.imageWidth, max_h / img.imageHeight, 1.0)
    img.drawWidth, img.drawHeight = img.imageWidth * scale, img.imageHeight * scale
    return img


def main():
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], fontSize=16, spaceAfter=8)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=13, spaceBefore=8, spaceAfter=4)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=10, leading=13)
    mono = ParagraphStyle("m", parent=body, fontName="Courier", fontSize=9, leading=12)
    title = ParagraphStyle("t", parent=ss["Title"], fontSize=20)

    doc = SimpleDocTemplate(str(HERE / f"{SRN}_Schema_Lab03.pdf"), pagesize=A4,
                            leftMargin=1.6 * cm, rightMargin=1.6 * cm,
                            topMargin=1.5 * cm, bottomMargin=1.5 * cm,
                            title=f"{SRN} Schema Lab03")
    W = A4[0] - 3.2 * cm
    H = A4[1] - 3 * cm
    story = [
        Spacer(1, 3 * cm),
        Paragraph("Database Management Systems Lab - 03", title),
        Paragraph("ER to Relational Schema Mapping and DDL Query Execution", ss["Heading2"]),
        Paragraph("Smart Hostel Management System - A Case Study", ss["Heading3"]),
        Spacer(1, 1 * cm),
        Paragraph(f"<b>SRN:</b> {SRN}", body),
        Spacer(1, 0.4 * cm),
        Paragraph("Contents: Task 1 - Relational schema (mapping rules, relations, schema "
                  "diagram). Task 2 - DDL execution screenshots for steps 2.1 to 2.9 "
                  f"(SQL file: {SRN}_DDL_Lab3.sql).", body),
        PageBreak(),
        Paragraph("Task 1 : ER to Relational Schema Mapping", h1),
        Paragraph("1.1 Mapping rules applied", h2),
    ]
    t = Table([[Paragraph(f"<b>{a}</b>", body), Paragraph(b, body)] for a, b in MAPPING],
              colWidths=[5.2 * cm, W - 5.2 * cm])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef3f9"))]))
    story += [t, Paragraph("1.2 Relational schema", h2),
              Paragraph("Primary keys are <u>underlined</u>; foreign keys are listed under "
                        "each relation.", body), Spacer(1, 4)]
    for name, cols, pk, fks in SCHEMA:
        cols_txt = ", ".join(f"<u>{c}</u>" if c in pk else c for c in cols)
        parts = [Paragraph(f"<b>{name}</b> ( {cols_txt} )", body)]
        for k, ref in fks.items():
            parts.append(Paragraph(f"&nbsp;&nbsp;&nbsp;&nbsp;FK {k} &rarr; {ref}", mono))
        parts.append(Spacer(1, 4))
        story.append(KeepTogether(parts))
    story += [PageBreak(), Paragraph("1.3 Relational schema diagram", h2),
              fit_image(schema_diagram(), W, H - 2 * cm), PageBreak(),
              Paragraph("Task 2 : DDL Query Execution (screenshots)", h1)]

    manifest = json.loads((SHOTS / "manifest.json").read_text())
    for step in manifest:
        sid = step["step"]
        heading = "Setup" if sid == "0" else f"Step {sid}"
        first = True
        for img in step["images"]:
            block = []
            if first:
                block += [Paragraph(heading, h2), Paragraph(STEP_NOTES[sid], body), Spacer(1, 4)]
                first = False
            block.append(fit_image(SHOTS / img, W, H - 3 * cm))
            block.append(Spacer(1, 8))
            story.append(KeepTogether(block))
    doc.build(story)


if __name__ == "__main__":
    main()
