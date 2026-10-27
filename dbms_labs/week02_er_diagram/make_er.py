"""Generate the Chen-notation ER diagram for the Smart Hostel Management System.

Usage: python3 make_er.py   (needs Graphviz `neato`)
"""
import subprocess
from pathlib import Path

OUT = Path(__file__).parent
SRN = "PES1UG24AM387"
S = 55.0  # pixels of the hand layout per inch

# name -> (kind, x, y, label)
# kinds: E entity, W weak entity, R relationship, IR identifying relationship,
#        A attribute, K key, PK partial key, MV multivalued, D derived
N = {
    # HOSTEL
    "HOSTEL": ("E", 550, 290, "HOSTEL"),
    "Hostel_ID": ("K", 625, 222, "Hostel_ID"),
    "Hostel_Name": ("A", 546, 190, "Hostel_Name"),
    "Location": ("A", 455, 205, "Location"),
    "Capacity": ("A", 420, 250, "Capacity"),
    # STAFF
    "STAFF": ("E", 300, 310, "STAFF"),
    "Staff_ID": ("K", 185, 345, "Staff_ID"),
    "S_Name": ("A", 220, 385, "Name"),
    "Salary": ("A", 300, 405, "Salary"),
    "Designation": ("A", 385, 375, "Designation"),
    "SUPERVISES": ("R", 215, 225, "SUPERVISES"),
    "EMPLOYS": ("R", 420, 305, "EMPLOYS"),
    # ROOM (weak)
    "HAS": ("IR", 470, 370, "HAS"),
    "ROOM": ("W", 572, 440, "ROOM"),
    "Room_Number": ("PK", 440, 430, "Room_Number"),
    "Floor": ("A", 470, 475, "Floor"),
    "Bed": ("MV", 560, 500, "Bed"),
    "Bed_Number": ("A", 505, 545, "Bed_Number"),
    "Availability": ("A", 610, 548, "Availability"),
    # ALLOCATES
    "ALLOCATES": ("R", 682, 440, "ALLOCATES"),
    "Allocation_Date": ("A", 772, 372, "Allocation_Date"),
    "Check_in_Date": ("A", 668, 360, "Check_in_Date"),
    "Check_out_Date": ("A", 575, 380, "Check_out_Date"),
    # STUDENT
    "STUDENT": ("E", 830, 440, "STUDENT"),
    "Student_ID": ("K", 760, 530, "Student_ID"),
    "Student_Name": ("A", 860, 520, "Student_Name"),
    "First_Name": ("A", 785, 575, "First_Name"),
    "Middle_Name": ("A", 880, 600, "Middle_Name"),
    "Last_Name": ("A", 955, 560, "Last_Name"),
    "Gender": ("A", 925, 495, "Gender"),
    "Date_of_Birth": ("A", 950, 455, "Date_of_Birth"),
    "Age": ("D", 950, 418, "Age"),
    "Phone_Number": ("MV", 930, 378, "Phone_Number"),
    "Email_Address": ("A", 880, 340, "Email_Address"),
    # PAYMENT / RECEIPT
    "MAKES": ("R", 680, 505, "MAKES"),
    "PAYMENT": ("E", 755, 615, "PAYMENT"),
    "Payment_ID": ("K", 645, 575, "Payment_ID"),
    "Payment_Date": ("A", 640, 650, "Payment_Date"),
    "Amount": ("A", 700, 690, "Amount"),
    "Payment_Type": ("A", 800, 690, "Payment_Type"),
    "GENERATES": ("R", 905, 635, "GENERATES"),
    "RECEIPT": ("E", 1045, 635, "RECEIPT"),
    "Receipt_ID": ("K", 1110, 590, "Receipt_ID"),
    "Receipt_Date": ("A", 1030, 570, "Receipt_Date"),
    # FACILITY
    "PROVIDES": ("R", 705, 268, "PROVIDES"),
    "FACILITY": ("E", 845, 268, "FACILITY"),
    "Facility_ID": ("K", 945, 300, "Facility_ID"),
    "Facility_Name": ("A", 870, 215, "Facility_Name"),
    "Operating_Hours": ("A", 745, 205, "Operating_Hours"),
    "USES": ("R", 790, 340, "USES"),
}

ATTR_EDGES = [
    ("HOSTEL", a) for a in ("Hostel_ID", "Hostel_Name", "Location", "Capacity")
] + [
    ("STAFF", a) for a in ("Staff_ID", "S_Name", "Salary", "Designation")
] + [
    ("ROOM", "Room_Number"), ("ROOM", "Floor"), ("ROOM", "Bed"),
    ("Bed", "Bed_Number"), ("Bed", "Availability"),
    ("ALLOCATES", "Allocation_Date"), ("ALLOCATES", "Check_in_Date"),
    ("ALLOCATES", "Check_out_Date"),
] + [
    ("STUDENT", a) for a in ("Student_ID", "Student_Name", "Gender",
                             "Date_of_Birth", "Age", "Phone_Number", "Email_Address")
] + [
    ("Student_Name", "First_Name"), ("Student_Name", "Middle_Name"),
    ("Student_Name", "Last_Name"),
] + [
    ("PAYMENT", a) for a in ("Payment_ID", "Payment_Date", "Amount", "Payment_Type")
] + [
    ("RECEIPT", "Receipt_ID"), ("RECEIPT", "Receipt_Date"),
] + [
    ("FACILITY", a) for a in ("Facility_ID", "Facility_Name", "Operating_Hours")
]

# (a, b, cardinality label at b-end side, total participation of a?)
# Each relationship is drawn as two edges: entity -- diamond.
REL_EDGES = [
    # entity, relationship, cardinality, total participation
    ("HOSTEL", "EMPLOYS", "1", False),
    ("STAFF", "EMPLOYS", "N", True),
    ("HOSTEL", "HAS", "1", True),
    ("ROOM", "HAS", "N", True),
    ("ROOM", "ALLOCATES", "M", False),
    ("STUDENT", "ALLOCATES", "N", False),
    ("STUDENT", "MAKES", "1", False),
    ("PAYMENT", "MAKES", "N", True),
    ("PAYMENT", "GENERATES", "1", True),
    ("RECEIPT", "GENERATES", "1", True),
    ("HOSTEL", "PROVIDES", "1", False),
    ("FACILITY", "PROVIDES", "N", True),
    ("STUDENT", "USES", "M", False),
    ("FACILITY", "USES", "N", False),
]


def node_attrs(kind, label):
    base = 'fontname="Helvetica"'
    if kind == "E":
        return f'shape=box style=filled fillcolor="#e3ecf7" fontsize=13 label="{label}" {base}'
    if kind == "W":
        return (f'shape=box peripheries=2 style=filled fillcolor="#e3ecf7" '
                f'fontsize=13 label="{label}" {base}')
    if kind == "R":
        return f'shape=diamond style=filled fillcolor="#fdf1d8" fontsize=10 label="{label}" {base}'
    if kind == "IR":
        return (f'shape=diamond peripheries=2 style=filled fillcolor="#fdf1d8" '
                f'fontsize=10 label="{label}" {base}')
    if kind == "K":
        return f'shape=ellipse fontsize=10 label=<<U>{label}</U>> {base}'
    if kind == "PK":
        return f'shape=ellipse fontsize=10 label=<<U><I>{label}</I></U>> {base}'
    if kind == "MV":
        return f'shape=ellipse peripheries=2 fontsize=10 label="{label}" {base}'
    if kind == "D":
        return f'shape=ellipse style=dashed fontsize=10 label="{label}" {base}'
    return f'shape=ellipse fontsize=10 label="{label}" {base}'


def build():
    lines = [
        "graph ER {",
        '  graph [splines=line outputorder=edgesfirst bgcolor=white pad=0.3 '
        f'label="Smart Hostel Management System - ER Diagram (Chen notation)   |   {SRN}" '
        'labelloc=t fontsize=16 fontname="Helvetica-Bold"];',
        '  node [margin="0.06,0.03" height=0.3];',
        '  edge [color="#333333"];',
    ]
    for name, (kind, x, y, label) in N.items():
        lines.append(f'  "{name}" [{node_attrs(kind, label)} pos="{x / S:.2f},{-y / S:.2f}!"];')
    for a, b in ATTR_EDGES:
        lines.append(f'  "{a}" -- "{b}";')
    for ent, rel, card, total in REL_EDGES:
        style = 'color="black:white:black" penwidth=1.2' if total else 'color="black"'
        lines.append(f'  "{ent}" -- "{rel}" [{style} headlabel="" taillabel="{card}" '
                     f'labeldistance=1.6 labelangle=25 fontsize=11 fontname="Helvetica-Bold"];')
    # Recursive SUPERVISES: two role edges
    lines.append('  "STAFF" -- "SUPERVISES" [tailport=n taillabel="1 (Supervisor)" fontsize=10 '
                 'labeldistance=4 labelangle=-40 fontname="Helvetica"];')
    lines.append('  "SUPERVISES" -- "STAFF" [headport=w headlabel="N (Supervised)" fontsize=10 '
                 'labeldistance=4 labelangle=40 fontname="Helvetica"];')
    legend = (
        '<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="1" CELLPADDING="2">'
        '<TR><TD COLSPAN="2"><B>Chen notation</B></TD></TR>'
        '<TR><TD ALIGN="LEFT">Rectangle</TD><TD ALIGN="LEFT">Strong entity</TD></TR>'
        '<TR><TD ALIGN="LEFT">Double rectangle</TD><TD ALIGN="LEFT">Weak entity (ROOM)</TD></TR>'
        '<TR><TD ALIGN="LEFT">Diamond</TD><TD ALIGN="LEFT">Relationship</TD></TR>'
        '<TR><TD ALIGN="LEFT">Double diamond</TD><TD ALIGN="LEFT">Identifying relationship (HAS)</TD></TR>'
        '<TR><TD ALIGN="LEFT"><U>Underlined</U></TD><TD ALIGN="LEFT">Primary key</TD></TR>'
        '<TR><TD ALIGN="LEFT"><U><I>Italic underlined</I></U></TD><TD ALIGN="LEFT">Partial key (dashed underline)</TD></TR>'
        '<TR><TD ALIGN="LEFT">Double oval</TD><TD ALIGN="LEFT">Multivalued attribute</TD></TR>'
        '<TR><TD ALIGN="LEFT">Dashed oval</TD><TD ALIGN="LEFT">Derived attribute</TD></TR>'
        '<TR><TD ALIGN="LEFT">Double line</TD><TD ALIGN="LEFT">Total participation</TD></TR>'
        '<TR><TD ALIGN="LEFT">Single line</TD><TD ALIGN="LEFT">Partial participation</TD></TR>'
        '<TR><TD COLSPAN="2" ALIGN="LEFT">BED is a multivalued composite attribute of ROOM</TD></TR>'
        '</TABLE>>'
    )
    lines.append(f'  legend [shape=plaintext fontsize=10 fontname="Helvetica" label={legend} '
                 f'pos="{300 / S:.2f},{-600 / S:.2f}!"];')
    lines.append("}")
    return "\n".join(lines)


if __name__ == "__main__":
    dot = OUT / f"{SRN}_ERDiagram_Lab02.dot"
    dot.write_text(build())
    for fmt in ("png", "svg", "pdf"):
        extra = ["-Gdpi=170"] if fmt == "png" else []
        subprocess.run(["neato", f"-T{fmt}", *extra, str(dot),
                        "-o", str(OUT / f"{SRN}_ERDiagram_Lab02.{fmt}")], check=True)
