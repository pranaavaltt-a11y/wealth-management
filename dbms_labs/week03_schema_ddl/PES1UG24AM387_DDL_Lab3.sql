-- =====================================================================
-- DBMS Lab 03 : ER to Relational Schema Mapping and DDL Query Execution
-- Smart Hostel Management System
-- SRN : PES1UG24AM387
-- =====================================================================

-- Prompt shown in every screenshot
prompt (PES1UG24AM387@\U)[\d]>\_

-- ---------------------------------------------------------------------
-- 2.1  Create the database and the tables (PK, NOT NULL, UNIQUE,
--      DEFAULT, CHECK) and add each foreign key with one referential
--      action. Every constraint is named (pk_, fk_, uq_, chk_).
-- ---------------------------------------------------------------------
DROP DATABASE IF EXISTS smart_hostel;
CREATE DATABASE smart_hostel;
USE smart_hostel;

-- Strong entity HOSTEL
CREATE TABLE hostel (
    Hostel_ID    VARCHAR(10)  NOT NULL,
    Hostel_Name  VARCHAR(50)  NOT NULL,
    Location     VARCHAR(100) NOT NULL,
    Capacity     INT          NOT NULL DEFAULT 100,
    CONSTRAINT pk_hostel PRIMARY KEY (Hostel_ID),
    CONSTRAINT uq_hostel_name UNIQUE (Hostel_Name),
    CONSTRAINT chk_hostel_capacity CHECK (Capacity > 0)
);

-- Strong entity STAFF
--   EMPLOYS (1:N, STAFF total)       -> Hostel_ID FK, NOT NULL
--   SUPERVISES (1:N recursive)       -> Supervisor_ID FK (added in 2.3)
CREATE TABLE staff (
    Staff_ID       VARCHAR(10)   NOT NULL,
    Name           VARCHAR(50)   NOT NULL,
    Salary         DECIMAL(10,2) NOT NULL,
    Designation    VARCHAR(30)   NOT NULL DEFAULT 'Cleaner',
    Hostel_ID      VARCHAR(10)   NOT NULL,
    Supervisor_ID  VARCHAR(10)   NULL,
    CONSTRAINT pk_staff PRIMARY KEY (Staff_ID),
    CONSTRAINT chk_staff_salary CHECK (Salary > 0),
    CONSTRAINT fk_staff_hostel FOREIGN KEY (Hostel_ID)
        REFERENCES hostel (Hostel_ID) ON UPDATE CASCADE
);

-- Weak entity ROOM, identified through HAS by its owner HOSTEL
--   PK = owner key Hostel_ID + partial key Room_Number
CREATE TABLE room (
    Hostel_ID    VARCHAR(10) NOT NULL,
    Room_Number  VARCHAR(10) NOT NULL,
    Floor        INT         NOT NULL DEFAULT 0,
    CONSTRAINT pk_room PRIMARY KEY (Hostel_ID, Room_Number),
    CONSTRAINT chk_room_floor CHECK (Floor >= 0),
    CONSTRAINT fk_room_hostel FOREIGN KEY (Hostel_ID)
        REFERENCES hostel (Hostel_ID) ON DELETE CASCADE
);

-- Multivalued composite attribute Bed {Bed_Number, Availability} of ROOM
CREATE TABLE room_bed (
    Hostel_ID     VARCHAR(10) NOT NULL,
    Room_Number   VARCHAR(10) NOT NULL,
    Bed_Number    INT         NOT NULL,
    Availability  VARCHAR(12) NOT NULL DEFAULT 'Available',
    CONSTRAINT pk_room_bed PRIMARY KEY (Hostel_ID, Room_Number, Bed_Number),
    CONSTRAINT chk_bed_availability CHECK (Availability IN ('Available', 'Occupied')),
    CONSTRAINT fk_bed_room FOREIGN KEY (Hostel_ID, Room_Number)
        REFERENCES room (Hostel_ID, Room_Number) ON DELETE CASCADE
);

-- Strong entity STUDENT
--   Composite Student_Name -> First_Name, Middle_Name, Last_Name
--   Derived Age            -> not stored (computed from Date_of_Birth)
--   Multivalued Phone      -> separate table student_phone
CREATE TABLE student (
    Student_ID     VARCHAR(15) NOT NULL,
    First_Name     VARCHAR(30) NOT NULL,
    Middle_Name    VARCHAR(30) NULL,
    Last_Name      VARCHAR(30) NOT NULL,
    Gender         CHAR(1)     NOT NULL,
    Date_of_Birth  DATE        NOT NULL,
    Email_Address  VARCHAR(50) NOT NULL,
    CONSTRAINT pk_student PRIMARY KEY (Student_ID),
    CONSTRAINT uq_student_email UNIQUE (Email_Address),
    CONSTRAINT chk_student_gender CHECK (Gender IN ('M', 'F', 'O'))
);

-- Multivalued attribute Phone_Number of STUDENT
CREATE TABLE student_phone (
    Student_ID    VARCHAR(15) NOT NULL,
    Phone_Number  VARCHAR(15) NOT NULL,
    CONSTRAINT pk_student_phone PRIMARY KEY (Student_ID, Phone_Number),
    CONSTRAINT fk_phone_student FOREIGN KEY (Student_ID)
        REFERENCES student (Student_ID) ON DELETE CASCADE
);

-- M:N relationship ALLOCATES (ROOM - STUDENT) with its attributes
CREATE TABLE allocation (
    Student_ID       VARCHAR(15) NOT NULL,
    Hostel_ID        VARCHAR(10) NOT NULL,
    Room_Number      VARCHAR(10) NOT NULL,
    Allocation_Date  DATE        NOT NULL,
    Check_in_Date    DATE        NULL,
    Check_out_Date   DATE        NULL,
    CONSTRAINT pk_allocation PRIMARY KEY (Student_ID, Hostel_ID, Room_Number),
    CONSTRAINT chk_alloc_checkin CHECK (Check_in_Date IS NULL OR Check_in_Date >= Allocation_Date),
    CONSTRAINT chk_alloc_checkout CHECK (Check_out_Date IS NULL OR Check_out_Date >= Check_in_Date),
    CONSTRAINT fk_alloc_student FOREIGN KEY (Student_ID)
        REFERENCES student (Student_ID) ON DELETE CASCADE,
    CONSTRAINT fk_alloc_room FOREIGN KEY (Hostel_ID, Room_Number)
        REFERENCES room (Hostel_ID, Room_Number) ON UPDATE CASCADE
);

-- Strong entity PAYMENT; MAKES (1:N, PAYMENT total) -> Student_ID FK, NOT NULL
CREATE TABLE payment (
    Payment_ID    VARCHAR(15)   NOT NULL,
    Payment_Date  DATE          NOT NULL,
    Amount        DECIMAL(10,2) NOT NULL,
    Payment_Type  VARCHAR(20)   NOT NULL DEFAULT 'UPI',
    Student_ID    VARCHAR(15)   NOT NULL,
    CONSTRAINT pk_payment PRIMARY KEY (Payment_ID),
    CONSTRAINT chk_payment_amount CHECK (Amount > 0),
    CONSTRAINT chk_payment_type CHECK (Payment_Type IN ('Cash', 'UPI', 'Card', 'NetBanking', 'Cheque')),
    CONSTRAINT fk_payment_student FOREIGN KEY (Student_ID)
        REFERENCES student (Student_ID) ON DELETE CASCADE
);

-- Strong entity RECEIPT; GENERATES (1:1, both total)
--   FK on RECEIPT side, NOT NULL + UNIQUE enforces exactly one receipt per payment
CREATE TABLE receipt (
    Receipt_ID    VARCHAR(15) NOT NULL,
    Receipt_Date  DATE        NOT NULL,
    Payment_ID    VARCHAR(15) NOT NULL,
    CONSTRAINT pk_receipt PRIMARY KEY (Receipt_ID),
    CONSTRAINT uq_receipt_payment UNIQUE (Payment_ID),
    CONSTRAINT fk_receipt_payment FOREIGN KEY (Payment_ID)
        REFERENCES payment (Payment_ID) ON DELETE CASCADE
);

-- Strong entity FACILITY; PROVIDES (1:N, FACILITY total) -> Hostel_ID FK, NOT NULL
CREATE TABLE facility (
    Facility_ID      VARCHAR(10) NOT NULL,
    Facility_Name    VARCHAR(40) NOT NULL,
    Operating_Hours  VARCHAR(30) NOT NULL DEFAULT '06:00-22:00',
    Hostel_ID        VARCHAR(10) NOT NULL,
    CONSTRAINT pk_facility PRIMARY KEY (Facility_ID),
    CONSTRAINT uq_facility_hostel_name UNIQUE (Hostel_ID, Facility_Name),
    CONSTRAINT fk_facility_hostel FOREIGN KEY (Hostel_ID)
        REFERENCES hostel (Hostel_ID) ON DELETE CASCADE
);

-- M:N relationship USES (STUDENT - FACILITY)
CREATE TABLE facility_usage (
    Student_ID   VARCHAR(15) NOT NULL,
    Facility_ID  VARCHAR(10) NOT NULL,
    CONSTRAINT pk_facility_usage PRIMARY KEY (Student_ID, Facility_ID),
    CONSTRAINT fk_usage_student FOREIGN KEY (Student_ID)
        REFERENCES student (Student_ID) ON DELETE CASCADE,
    CONSTRAINT fk_usage_facility FOREIGN KEY (Facility_ID)
        REFERENCES facility (Facility_ID) ON DELETE CASCADE
);

SHOW TABLES;
DESC hostel;
DESC staff;
DESC room;
DESC room_bed;
DESC student;
DESC student_phone;
DESC allocation;
DESC payment;
DESC receipt;
DESC facility;
DESC facility_usage;

-- Named constraints of every table
SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'smart_hostel'
ORDER BY TABLE_NAME, CONSTRAINT_TYPE, CONSTRAINT_NAME;

-- ---------------------------------------------------------------------
-- 2.2  Add a new attribute as the first column of FACILITY, with a default
-- ---------------------------------------------------------------------
ALTER TABLE facility
    ADD COLUMN Facility_Status VARCHAR(12) NOT NULL DEFAULT 'Active' FIRST;
DESC facility;

-- ---------------------------------------------------------------------
-- 2.3  Add the foreign key missed in CREATE TABLE:
--      recursive SUPERVISES on STAFF (supervisor leaves -> set NULL)
-- ---------------------------------------------------------------------
ALTER TABLE staff
    ADD CONSTRAINT fk_staff_supervisor FOREIGN KEY (Supervisor_ID)
        REFERENCES staff (Staff_ID) ON DELETE SET NULL;
DESC staff;
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'smart_hostel'
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

-- ---------------------------------------------------------------------
-- 2.4  Rename Designation to Position in STAFF
-- ---------------------------------------------------------------------
ALTER TABLE staff RENAME COLUMN Designation TO Position;
DESC staff;

-- ---------------------------------------------------------------------
-- 2.5  Change Gender from CHAR to ENUM
-- ---------------------------------------------------------------------
ALTER TABLE student MODIFY COLUMN Gender ENUM('M', 'F', 'O') NOT NULL;
DESC student;

-- ---------------------------------------------------------------------
-- 2.6  Drop the column Position from STAFF
-- ---------------------------------------------------------------------
ALTER TABLE staff DROP COLUMN Position;
DESC staff;

-- ---------------------------------------------------------------------
-- 2.7  Change the size of Email_Address in STUDENT (50 -> 100)
-- ---------------------------------------------------------------------
ALTER TABLE student MODIFY COLUMN Email_Address VARCHAR(100) NOT NULL;
DESC student;

-- ---------------------------------------------------------------------
-- 2.8  Rename table student to students
-- ---------------------------------------------------------------------
RENAME TABLE student TO students;
SHOW TABLES;
DESC students;

-- ---------------------------------------------------------------------
-- 2.9  Drop one table (facility_usage) after dropping its constraints
-- ---------------------------------------------------------------------
ALTER TABLE facility_usage DROP FOREIGN KEY fk_usage_student;
ALTER TABLE facility_usage DROP FOREIGN KEY fk_usage_facility;
ALTER TABLE facility_usage DROP PRIMARY KEY;
DESC facility_usage;
DROP TABLE facility_usage;
SHOW TABLES;
