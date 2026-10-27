-- =====================================================================
-- DBMS Lab 05 (Week 5) : DML and Join SQL Queries
-- Smart Hostel Management System
-- SRN : PES1UG24AM387
-- =====================================================================

-- @step P | Set the prompt
prompt (PES1UG24AM387@\u) [\d]>\_

-- =====================================================================
-- Task 1 : Database preparation
-- =====================================================================

-- @step S1 | Create the database
DROP DATABASE IF EXISTS smart_hostel;
CREATE DATABASE smart_hostel;
USE smart_hostel;

-- @step S2 | Create HOSTEL, STAFF, ROOM, BED
CREATE TABLE hostel (
    Hostel_ID    INT          NOT NULL,
    Hostel_Name  VARCHAR(50)  NOT NULL,
    Location     VARCHAR(100) NOT NULL,
    Capacity     INT          NOT NULL DEFAULT 0,
    CONSTRAINT pk_hostel PRIMARY KEY (Hostel_ID),
    CONSTRAINT chk_hostel_capacity CHECK (Capacity >= 0)
);

CREATE TABLE staff (
    Staff_ID       INT           NOT NULL,
    Staff_Name     VARCHAR(50)   NOT NULL,
    Salary         DECIMAL(10,2) NOT NULL,
    Designation    VARCHAR(30)   NOT NULL DEFAULT 'Support Staff',
    Hostel_ID      INT           NOT NULL,
    Supervisor_ID  INT           NULL,
    CONSTRAINT pk_staff PRIMARY KEY (Staff_ID),
    CONSTRAINT chk_staff_salary CHECK (Salary > 0),
    CONSTRAINT fk_staff_hostel FOREIGN KEY (Hostel_ID) REFERENCES hostel (Hostel_ID),
    CONSTRAINT fk_staff_supervisor FOREIGN KEY (Supervisor_ID)
        REFERENCES staff (Staff_ID) ON DELETE SET NULL
);

CREATE TABLE room (
    Hostel_ID    INT NOT NULL,
    Room_Number  INT NOT NULL,
    Floor        INT NOT NULL DEFAULT 0,
    CONSTRAINT pk_room PRIMARY KEY (Hostel_ID, Room_Number),
    CONSTRAINT fk_room_hostel FOREIGN KEY (Hostel_ID)
        REFERENCES hostel (Hostel_ID) ON DELETE CASCADE
);

CREATE TABLE bed (
    Hostel_ID    INT         NOT NULL,
    Room_Number  INT         NOT NULL,
    Bed_Number   INT         NOT NULL,
    Status       VARCHAR(10) NOT NULL DEFAULT 'Vacant',
    CONSTRAINT pk_bed PRIMARY KEY (Hostel_ID, Room_Number, Bed_Number),
    CONSTRAINT chk_bed_status CHECK (Status IN ('Occupied', 'Vacant')),
    CONSTRAINT fk_bed_room FOREIGN KEY (Hostel_ID, Room_Number)
        REFERENCES room (Hostel_ID, Room_Number) ON DELETE CASCADE
);

-- @step S3 | Create STUDENT, STUDENT_PHONE, FACILITY, USES
CREATE TABLE student (
    Student_ID   INT         NOT NULL,
    First_Name   VARCHAR(30) NOT NULL,
    Middle_Name  VARCHAR(30) NULL,
    Last_Name    VARCHAR(30) NOT NULL,
    Gender       CHAR(1)     NOT NULL,
    DOB          DATE        NOT NULL,
    Email        VARCHAR(60) NOT NULL,
    CONSTRAINT pk_student PRIMARY KEY (Student_ID),
    CONSTRAINT uq_student_email UNIQUE (Email),
    CONSTRAINT chk_student_gender CHECK (Gender IN ('M', 'F', 'O'))
);

CREATE TABLE student_phone (
    Student_ID    INT         NOT NULL,
    Phone_Number  VARCHAR(15) NOT NULL,
    CONSTRAINT pk_student_phone PRIMARY KEY (Student_ID, Phone_Number),
    CONSTRAINT fk_phone_student FOREIGN KEY (Student_ID)
        REFERENCES student (Student_ID) ON DELETE CASCADE
);

CREATE TABLE facility (
    Facility_ID      INT         NOT NULL,
    Facility_Name    VARCHAR(40) NOT NULL,
    Operating_Hours  VARCHAR(30) DEFAULT '24x7',
    Hostel_ID        INT         NOT NULL,
    CONSTRAINT pk_facility PRIMARY KEY (Facility_ID),
    CONSTRAINT fk_facility_hostel FOREIGN KEY (Hostel_ID)
        REFERENCES hostel (Hostel_ID) ON DELETE CASCADE
);

CREATE TABLE uses (
    Student_ID   INT  NOT NULL,
    Facility_ID  INT  NOT NULL,
    Usage_Date   DATE NOT NULL,
    CONSTRAINT pk_uses PRIMARY KEY (Student_ID, Facility_ID, Usage_Date),
    CONSTRAINT fk_uses_student FOREIGN KEY (Student_ID)
        REFERENCES student (Student_ID) ON DELETE CASCADE,
    CONSTRAINT fk_uses_facility FOREIGN KEY (Facility_ID)
        REFERENCES facility (Facility_ID) ON DELETE CASCADE
);

-- @step S4 | Create ALLOCATION, PAYMENT, RECEIPT
CREATE TABLE allocation (
    Allocation_ID    INT  NOT NULL,
    Student_ID       INT  NOT NULL,
    Hostel_ID        INT  NOT NULL,
    Room_Number      INT  NOT NULL,
    Allocation_Date  DATE NOT NULL,
    Check_in_Date    DATE NOT NULL,
    Check_out_Date   DATE NULL,
    CONSTRAINT pk_allocation PRIMARY KEY (Allocation_ID),
    CONSTRAINT fk_alloc_student FOREIGN KEY (Student_ID)
        REFERENCES student (Student_ID) ON DELETE CASCADE,
    CONSTRAINT fk_alloc_room FOREIGN KEY (Hostel_ID, Room_Number)
        REFERENCES room (Hostel_ID, Room_Number) ON DELETE CASCADE
);

CREATE TABLE payment (
    Payment_ID    INT           NOT NULL,
    Student_ID    INT           NOT NULL,
    Payment_Date  DATE          NOT NULL,
    Amount        DECIMAL(10,2) NOT NULL,
    Payment_Type  VARCHAR(20)   NOT NULL,
    CONSTRAINT pk_payment PRIMARY KEY (Payment_ID),
    CONSTRAINT chk_payment_amount CHECK (Amount > 0),
    CONSTRAINT fk_payment_student FOREIGN KEY (Student_ID) REFERENCES student (Student_ID)
);

CREATE TABLE receipt (
    Receipt_ID    INT  NOT NULL,
    Payment_ID    INT  NOT NULL,
    Receipt_Date  DATE NOT NULL,
    CONSTRAINT pk_receipt PRIMARY KEY (Receipt_ID),
    CONSTRAINT uq_receipt_payment UNIQUE (Payment_ID),
    CONSTRAINT fk_receipt_payment FOREIGN KEY (Payment_ID) REFERENCES payment (Payment_ID)
);

-- @step S5 | Verify the schema (SHOW TABLES, DESC)
SHOW TABLES;
DESC hostel;
DESC staff;
DESC room;
DESC bed;
DESC student;
DESC student_phone;
DESC facility;
DESC uses;
DESC allocation;
DESC payment;
DESC receipt;

-- @step D1 | Populate the tables with the sample data
INSERT INTO hostel (Hostel_ID, Hostel_Name, Location, Capacity) VALUES
    (1, 'Sunrise Hostel', 'North Campus', 120),
    (2, 'Blue Ridge Hostel', 'South Campus', 90),
    (3, 'Lake View Hostel', 'East Campus', 60);

INSERT INTO staff (Staff_ID, Staff_Name, Designation, Salary, Hostel_ID, Supervisor_ID) VALUES
    (1, 'Ramesh Iyer', 'Warden', 45000, 1, NULL),
    (2, 'Sunil Kumar', 'Security', 22000, 1, 1),
    (3, 'Geeta Rao', 'Cleaner', 18000, 1, 1),
    (4, 'Anita Sharma', 'Warden', 46000, 2, NULL),
    (5, 'Mohan Das', 'Security', 21000, 2, 4),
    (6, 'Priya Menon', 'Maintenance', 25000, 2, 4),
    (7, 'Kiran Bose', 'Warden', 44000, 3, NULL),
    (8, 'Farhan Sheikh', 'Cleaner', 17500, 3, 7);

INSERT INTO room (Hostel_ID, Room_Number, Floor) VALUES
    (1, 101, 1), (1, 102, 1), (1, 201, 2),
    (2, 101, 1), (2, 102, 1),
    (3, 101, 1);

INSERT INTO bed (Hostel_ID, Room_Number, Bed_Number, Status) VALUES
    (1, 101, 1, 'Occupied'), (1, 101, 2, 'Occupied'),
    (1, 102, 1, 'Occupied'), (1, 102, 2, 'Vacant'),
    (1, 201, 1, 'Occupied'), (1, 201, 2, 'Vacant'),
    (2, 101, 1, 'Occupied'), (2, 101, 2, 'Vacant'),
    (2, 102, 1, 'Occupied'), (2, 102, 2, 'Occupied'),
    (3, 101, 1, 'Occupied'), (3, 101, 2, 'Vacant');

INSERT INTO student (Student_ID, First_Name, Middle_Name, Last_Name, Gender, DOB, Email) VALUES
    (1, 'Aditya', NULL, 'Verma', 'M', '2005-03-14', 'aditya.verma@pes.edu'),
    (2, 'Neha', 'R', 'Kulkarni', 'F', '2005-07-22', 'neha.kulkarni@pes.edu'),
    (3, 'Rohan', NULL, 'Shetty', 'M', '2004-11-05', 'rohan.shetty@pes.edu'),
    (4, 'Sanya', 'K', 'Malhotra', 'F', '2005-01-30', 'sanya.malhotra@pes.edu'),
    (5, 'Vikram', NULL, 'Nair', 'M', '2004-09-18', 'vikram.nair@pes.edu'),
    (6, 'Ishita', 'P', 'Bansal', 'F', '2005-05-09', 'ishita.bansal@pes.edu'),
    (7, 'Arjun', NULL, 'Reddy', 'M', '2005-02-27', 'arjun.reddy@pes.edu'),
    (8, 'Meera', 'S', 'Pillai', 'F', '2004-12-12', 'meera.pillai@pes.edu');

INSERT INTO student_phone (Student_ID, Phone_Number) VALUES
    (1, '9876500001'), (1, '9876500011'), (2, '9876500002'), (3, '9876500003'),
    (4, '9876500004'), (4, '9876500014'), (5, '9876500005'), (6, '9876500006'),
    (7, '9876500007'), (8, '9876500008');

INSERT INTO facility (Facility_ID, Facility_Name, Operating_Hours, Hostel_ID) VALUES
    (1, 'WiFi Lounge', '24 Hours', 1),
    (2, 'Laundry Room', '06:00-20:00', 1),
    (3, 'Gym', '05:00-22:00', 2),
    (4, 'Study Room', '24 Hours', 2),
    (5, 'Common Room', '08:00-23:00', 3);

INSERT INTO uses (Student_ID, Facility_ID, Usage_Date) VALUES
    (1, 1, '2026-01-20'), (2, 1, '2026-01-20'), (3, 1, '2026-01-22'),
    (1, 2, '2026-01-21'), (4, 3, '2026-01-20'), (5, 3, '2026-01-21'),
    (4, 4, '2026-01-25'), (6, 4, '2026-01-22'), (7, 5, '2026-01-23');

INSERT INTO allocation (Allocation_ID, Student_ID, Hostel_ID, Room_Number,
                        Allocation_Date, Check_in_Date, Check_out_Date) VALUES
    (1, 1, 1, 101, '2026-01-05', '2026-01-06', NULL),
    (2, 2, 1, 101, '2026-01-05', '2026-01-06', NULL),
    (3, 3, 1, 102, '2026-01-06', '2026-01-07', NULL),
    (4, 4, 2, 101, '2026-01-05', '2026-01-06', NULL),
    (5, 5, 2, 102, '2026-01-06', '2026-01-07', NULL),
    (6, 6, 2, 102, '2026-01-06', '2026-01-07', NULL),
    (7, 7, 3, 101, '2026-01-07', '2026-01-08', NULL),
    (8, 3, 1, 201, '2025-06-01', '2025-06-02', '2025-12-20');

INSERT INTO payment (Payment_ID, Student_ID, Payment_Date, Amount, Payment_Type) VALUES
    (1, 1, '2026-01-10', 45000, 'Online'),
    (2, 2, '2026-01-11', 45000, 'Cash'),
    (3, 3, '2026-01-12', 42000, 'Card'),
    (4, 4, '2026-01-10', 48000, 'Online'),
    (5, 5, '2026-01-13', 48000, 'Cheque'),
    (6, 6, '2026-01-14', 48000, 'Online'),
    (7, 7, '2026-01-15', 40000, 'Cash'),
    (8, 1, '2026-06-01', 45000, 'Online');

INSERT INTO receipt (Receipt_ID, Payment_ID, Receipt_Date) VALUES
    (1, 1, '2026-01-10'), (2, 2, '2026-01-11'), (3, 3, '2026-01-12'),
    (4, 4, '2026-01-10'), (5, 5, '2026-01-13'), (6, 6, '2026-01-14'),
    (7, 7, '2026-01-15');

-- @step D2 | Verify the data: HOSTEL, STAFF, ROOM, BED
SELECT * FROM hostel;
SELECT * FROM staff;
SELECT * FROM room;
SELECT * FROM bed;

-- @step D3 | Verify the data: STUDENT, STUDENT_PHONE, FACILITY, USES
SELECT * FROM student;
SELECT * FROM student_phone;
SELECT * FROM facility;
SELECT * FROM uses;

-- @step D4 | Verify the data: ALLOCATION, PAYMENT, RECEIPT
SELECT * FROM allocation;
SELECT * FROM payment;
SELECT * FROM receipt;

-- =====================================================================
-- Task 2 : Part A -- DML and Set Operations
-- =====================================================================

-- @step A1 | Insert a new student, Kabir S. Oberoi (Male, DOB 2005-08-19, email kabir.oberoi@pes.edu), into Student.
INSERT INTO student (Student_ID, First_Name, Middle_Name, Last_Name, Gender, DOB, Email)
VALUES (9, 'Kabir', 'S', 'Oberoi', 'M', '2005-08-19', 'kabir.oberoi@pes.edu');
SELECT * FROM student WHERE Student_ID = 9;

-- @step A2 | In a single INSERT statement, add both of Kabir's phone numbers -- 9876500009 and 9876500019 -- to Student_Phone.
INSERT INTO student_phone (Student_ID, Phone_Number)
VALUES (9, '9876500009'), (9, '9876500019');
SELECT * FROM student_phone WHERE Student_ID = 9;

-- @step A3 | In a single INSERT statement, record three new facility usage events: Kabir uses the WiFi Lounge (Facility_ID 1) on 2026-08-22, Kabir uses the Common Room (Facility_ID 5) on 2026-08-23, and Vikram Nair (Student_ID 5) uses the Gym (Facility_ID 3) on 2026-08-22.
INSERT INTO uses (Student_ID, Facility_ID, Usage_Date)
VALUES (9, 1, '2026-08-22'), (9, 5, '2026-08-23'), (5, 3, '2026-08-22');
SELECT * FROM uses WHERE Usage_Date >= '2026-08-01';

-- @step A4 | The university approves a 10% salary hike for every Warden across all hostels. Update Staff accordingly.
UPDATE staff SET Salary = Salary * 1.10 WHERE Designation = 'Warden';
SELECT Staff_ID, Staff_Name, Designation, Salary FROM staff WHERE Designation = 'Warden';

-- @step A5 | Rohan Shetty (Student_ID 3) checks out of Room 102, Hostel 1 on 2026-08-20. Close his current allocation record and free up his bed (Bed_Number 1 in that room).
UPDATE allocation
SET Check_out_Date = '2026-08-20'
WHERE Student_ID = 3 AND Hostel_ID = 1 AND Room_Number = 102 AND Check_out_Date IS NULL;
UPDATE bed
SET Status = 'Vacant'
WHERE Hostel_ID = 1 AND Room_Number = 102 AND Bed_Number = 1;
SELECT * FROM allocation WHERE Student_ID = 3;
SELECT * FROM bed WHERE Hostel_ID = 1 AND Room_Number = 102;

-- @step A6 | Record a new payment of 45000 (Online) made by Kabir on 2026-08-22, and the receipt generated for it on the same date.
INSERT INTO payment (Payment_ID, Student_ID, Payment_Date, Amount, Payment_Type)
VALUES (9, 9, '2026-08-22', 45000, 'Online');
INSERT INTO receipt (Receipt_ID, Payment_ID, Receipt_Date)
VALUES (8, 9, '2026-08-22');
SELECT p.*, r.Receipt_ID, r.Receipt_Date
FROM payment p JOIN receipt r ON r.Payment_ID = p.Payment_ID
WHERE p.Payment_ID = 9;

-- @step A7 | Delete every payment that does not yet have a matching receipt. Do this with a subquery -- do not hard-code any Payment_ID.
SELECT * FROM payment WHERE Payment_ID NOT IN (SELECT Payment_ID FROM receipt);
DELETE FROM payment
WHERE Payment_ID NOT IN (SELECT Payment_ID FROM receipt);
SELECT * FROM payment;

-- @step A8 | List the names of all staff members working in Hostel 1 along with the first and last names of all students currently allocated to Hostel 1. Combine both result sets using UNION ALL. Display the name(s) and role (Staff or Student) for each record.
SELECT Staff_Name AS Name, 'Staff' AS Role
FROM staff
WHERE Hostel_ID = 1
UNION ALL
SELECT CONCAT(s.First_Name, ' ', s.Last_Name), 'Student'
FROM student s
JOIN allocation a ON a.Student_ID = s.Student_ID
WHERE a.Hostel_ID = 1 AND a.Check_out_Date IS NULL;

-- @step A9 | Using INTERSECT, find the Student_IDs of students who have both made at least one payment and used at least one facility.
SELECT Student_ID FROM payment
INTERSECT
SELECT Student_ID FROM uses
ORDER BY Student_ID;

-- @step A10 | Using EXCEPT, find every student who has never made a payment.
SELECT Student_ID, First_Name, Last_Name FROM student
EXCEPT
SELECT s.Student_ID, s.First_Name, s.Last_Name
FROM student s JOIN payment p ON p.Student_ID = s.Student_ID;

-- =====================================================================
-- Task 3 : Part B -- Join Queries
-- =====================================================================

-- @step B1 | List the Student_ID, first, middle and last name, hostel name and room number of every student who currently has an active allocation (Check_out_Date IS NULL).
SELECT s.Student_ID, s.First_Name, s.Middle_Name, s.Last_Name, h.Hostel_Name, a.Room_Number
FROM student s
INNER JOIN allocation a ON a.Student_ID = s.Student_ID
INNER JOIN hostel h ON h.Hostel_ID = a.Hostel_ID
WHERE a.Check_out_Date IS NULL
ORDER BY s.Student_ID;

-- @step B2 | List every staff member along with the name of their supervisor (show NULL/blank for staff with no supervisor).
SELECT e.Staff_ID, e.Staff_Name, e.Designation, m.Staff_Name AS Supervisor_Name
FROM staff e
LEFT JOIN staff m ON m.Staff_ID = e.Supervisor_ID
ORDER BY e.Staff_ID;

-- @step B3 | List every payment together with the paying student's name and the corresponding receipt number, if one has been generated.
SELECT p.Payment_ID, CONCAT(s.First_Name, ' ', s.Last_Name) AS Student_Name,
       p.Payment_Date, p.Amount, p.Payment_Type, r.Receipt_ID
FROM payment p
INNER JOIN student s ON s.Student_ID = p.Student_ID
LEFT JOIN receipt r ON r.Payment_ID = p.Payment_ID
ORDER BY p.Payment_ID;

-- @step B4 | Find every student who has never used any hostel facility.
SELECT s.Student_ID, s.First_Name, s.Last_Name
FROM student s
LEFT JOIN uses u ON u.Student_ID = s.Student_ID
WHERE u.Student_ID IS NULL;

-- @step B5 | For each hostel, count how many students currently reside in it (include hostels with zero current residents).
SELECT h.Hostel_ID, h.Hostel_Name, COUNT(a.Student_ID) AS Current_Residents
FROM hostel h
LEFT JOIN allocation a ON a.Hostel_ID = h.Hostel_ID AND a.Check_out_Date IS NULL
GROUP BY h.Hostel_ID, h.Hostel_Name
ORDER BY h.Hostel_ID;

-- @step B6 | List every facility usage record as: facility name, student name, usage date -- ordered by facility, then date.
SELECT f.Facility_Name, CONCAT(s.First_Name, ' ', s.Last_Name) AS Student_Name, u.Usage_Date
FROM uses u
INNER JOIN facility f ON f.Facility_ID = u.Facility_ID
INNER JOIN student s ON s.Student_ID = u.Student_ID
ORDER BY f.Facility_Name, u.Usage_Date;

-- @step B7 | For every room, report how many beds in it are currently vacant.
SELECT r.Hostel_ID, r.Room_Number, COUNT(b.Bed_Number) AS Vacant_Beds
FROM room r
LEFT JOIN bed b ON b.Hostel_ID = r.Hostel_ID AND b.Room_Number = r.Room_Number
               AND b.Status = 'Vacant'
GROUP BY r.Hostel_ID, r.Room_Number
ORDER BY r.Hostel_ID, r.Room_Number;

-- @step B8 | List every staff member with the name and location of the hostel they work at.
SELECT st.Staff_ID, st.Staff_Name, st.Designation, h.Hostel_Name, h.Location
FROM staff st
INNER JOIN hostel h ON h.Hostel_ID = st.Hostel_ID
ORDER BY st.Staff_ID;

-- @step B9 | For each hostel, compute the total fee revenue collected from its currently-residing students.
SELECT h.Hostel_ID, h.Hostel_Name, COALESCE(SUM(p.Amount), 0) AS Total_Revenue
FROM hostel h
LEFT JOIN allocation a ON a.Hostel_ID = h.Hostel_ID AND a.Check_out_Date IS NULL
LEFT JOIN payment p ON p.Student_ID = a.Student_ID
GROUP BY h.Hostel_ID, h.Hostel_Name
ORDER BY h.Hostel_ID;

-- @step B10 | List every facility together with how many times it has been used, including facilities that have never been used.
SELECT f.Facility_ID, f.Facility_Name, COUNT(u.Student_ID) AS Times_Used
FROM facility f
LEFT JOIN uses u ON u.Facility_ID = f.Facility_ID
GROUP BY f.Facility_ID, f.Facility_Name
ORDER BY f.Facility_ID;

-- @step B11 | Write a query using a RIGHT JOIN between HOSTEL and FACILITY to list all facilities along with the name of the hostel providing each facility.
SELECT f.Facility_ID, f.Facility_Name, f.Operating_Hours, h.Hostel_Name
FROM hostel h
RIGHT JOIN facility f ON f.Hostel_ID = h.Hostel_ID
ORDER BY f.Facility_ID;

-- @step B12 | Write a query using a LEFT JOIN to list all students (First_Name, Last_Name, Email_Address) along with their assigned Room_Number. Ensure that students who do not have an allocated room, such as Rohan, are also included in the result.
SELECT s.First_Name, s.Last_Name, s.Email AS Email_Address, a.Room_Number
FROM student s
LEFT JOIN allocation a ON a.Student_ID = s.Student_ID AND a.Check_out_Date IS NULL
ORDER BY s.Student_ID;
