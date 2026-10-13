-- =====================================================================
-- DBMS Lab 08 : Isolation Level in Transaction Management
-- E-Commerce Order & Inventory Management - A Case Study
-- SRN  : PES1UG24AM387
-- Name : Pranaav
-- Run two MySQL client windows (Session 1 = Transaction A,
-- Session 2 = Transaction B) logged in as pes1ug24am387_pranaav.
-- In each window first run:   prompt \u@\h [\d]>\_
-- =====================================================================

-- ---------------------------------------------------------------------
-- Task 1 : Check MySQL Isolation Level
-- ---------------------------------------------------------------------
-- Q1.1  Session-level and global (server-wide) isolation level
SELECT @@SESSION.transaction_isolation AS session_isolation, @@GLOBAL.transaction_isolation AS global_isolation;

-- ---------------------------------------------------------------------
-- Task 2 : Database Setup and Sample Data
-- ---------------------------------------------------------------------
-- Q2.1  Create database, make it active, create tables
CREATE DATABASE ecommerce_db;
USE ecommerce_db;

CREATE TABLE Customer (customer_id INT PRIMARY KEY AUTO_INCREMENT, full_name VARCHAR(100) NOT NULL, email VARCHAR(150) UNIQUE NOT NULL, city VARCHAR(50) NOT NULL);

CREATE TABLE Product (product_id INT PRIMARY KEY AUTO_INCREMENT, product_name VARCHAR(100) NOT NULL, category VARCHAR(50) NOT NULL, price DECIMAL(10,2) NOT NULL, stock_quantity INT NOT NULL, status ENUM('Active','Inactive') DEFAULT 'Active', INDEX idx_category (category));

CREATE TABLE Orders (order_id INT PRIMARY KEY AUTO_INCREMENT, customer_id INT NOT NULL, product_id INT NOT NULL, quantity INT NOT NULL, total_amount DECIMAL(12,2) NOT NULL, order_status ENUM('Pending','Confirmed','Cancelled') DEFAULT 'Pending', FOREIGN KEY (customer_id) REFERENCES Customer(customer_id), FOREIGN KEY (product_id) REFERENCES Product(product_id));

SHOW TABLES;

-- Q2.2  Insert sample data (3 customers, 4 products, 3 orders)
INSERT INTO Customer (full_name, email, city) VALUES ('Ananya Rao', 'ananya.rao@example.com', 'Bengaluru'), ('Karan Mehta', 'karan.mehta@example.com', 'Mumbai'), ('Sofia Khan', 'sofia.khan@example.com', 'Delhi');

INSERT INTO Product (product_name, category, price, stock_quantity, status) VALUES ('Laptop Pro 14', 'Electronics', 85000.00, 20, 'Active'), ('Wireless Headphones', 'Electronics', 6500.00, 35, 'Active'), ('Office Chair', 'Furniture', 12000.00, 12, 'Active'), ('Mechanical Keyboard', 'Electronics', 4500.00, 25, 'Active');

INSERT INTO Orders (customer_id, product_id, quantity, total_amount, order_status) VALUES (1, 1, 1, 85000.00, 'Pending'), (2, 2, 2, 13000.00, 'Confirmed'), (3, 3, 1, 12000.00, 'Confirmed');

SELECT 'Customer' AS table_name, COUNT(*) AS rows_inserted FROM Customer UNION ALL SELECT 'Product', COUNT(*) FROM Product UNION ALL SELECT 'Orders', COUNT(*) FROM Orders;

-- Q2.3  Verify initial data
SELECT * FROM Customer;
SELECT * FROM Product;
SELECT * FROM Orders;

-- ---------------------------------------------------------------------
-- Task 3 : READ UNCOMMITTED  (dirty read)
-- ---------------------------------------------------------------------
-- Q3.1  [Session 1 - Transaction A]  (do NOT commit)
SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
START TRANSACTION;
UPDATE Product SET stock_quantity = 5 WHERE product_id = 1;
SELECT product_id, product_name, stock_quantity FROM Product WHERE product_id = 1;

-- Q3.2  [Session 2 - Transaction B]  (while A is still uncommitted)
USE ecommerce_db;
SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
START TRANSACTION;
SELECT product_id, product_name, stock_quantity FROM Product WHERE product_id = 1;
-- Observation: B sees stock_quantity = 5 -> uncommitted (dirty) data is visible.
ROLLBACK;
-- [Session 1 - Transaction A]
ROLLBACK;
SELECT product_id, product_name, stock_quantity FROM Product WHERE product_id = 1;
-- stock_quantity is back to 20, so the value B read never really existed.

-- ---------------------------------------------------------------------
-- Task 4 : READ COMMITTED  (committed-value visibility)
-- ---------------------------------------------------------------------
-- Q4.1  [Session 1 - Transaction A]
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
START TRANSACTION;
SELECT product_id, stock_quantity FROM Product WHERE product_id = 1;

-- Q4.2  [Session 2 - Transaction B]
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
START TRANSACTION;
UPDATE Product SET stock_quantity = 18 WHERE product_id = 1;
COMMIT;

-- Q4.3  [Session 1 - Transaction A]  (same transaction, read again)
SELECT product_id, stock_quantity FROM Product WHERE product_id = 1;
-- Observation: value changes 20 -> 18 inside the same transaction (non-repeatable read).
COMMIT;

-- ---------------------------------------------------------------------
-- Task 5 : REPEATABLE READ  (consistent repeated read)
-- ---------------------------------------------------------------------
-- Q5.1  [Session 1 - Transaction A]
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;
SELECT product_id, product_name, price, stock_quantity FROM Product WHERE category = 'Electronics' AND status = 'Active';

-- Q5.2  [Session 2 - Transaction B]
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;
UPDATE Product SET price = 7000.00 WHERE product_id = 2;
COMMIT;

-- Q5.3  [Session 1 - Transaction A]  (exact same query)
SELECT product_id, product_name, price, stock_quantity FROM Product WHERE category = 'Electronics' AND status = 'Active';
-- Observation: product 2 still shows 6500.00 (snapshot taken at first read).
COMMIT;
SELECT product_id, product_name, price FROM Product WHERE product_id = 2;
-- After commit the new price 7000.00 is visible.

-- ---------------------------------------------------------------------
-- Task 6 : SERIALIZABLE  (blocking concurrent range operation)
-- ---------------------------------------------------------------------
-- Q6.1  [Session 1 - Transaction A]  (keep open)
SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE;
START TRANSACTION;
SELECT product_id, product_name, category, status FROM Product WHERE category = 'Electronics' AND status = 'Active';

-- Q6.2  [Session 2 - Transaction B]  (this INSERT waits / blocks)
SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE;
START TRANSACTION;
INSERT INTO Product (product_name, category, price, stock_quantity, status) VALUES ('USB-C Dock', 'Electronics', 8000.00, 15, 'Active');

-- Q6.3  [Session 1 - Transaction A]
COMMIT;

-- Q6.4  [Session 2 - Transaction B]
-- The waiting INSERT completes ("Query OK, 1 row affected") as soon as A commits.
COMMIT;
SELECT product_id, product_name, category, status FROM Product WHERE category = 'Electronics' AND status = 'Active';

-- ---------------------------------------------------------------------
-- Task 7 : Verification Queries
-- ---------------------------------------------------------------------
-- Q7.1
SELECT * FROM Product;
SELECT o.order_id, c.full_name AS customer_name, p.product_name, o.quantity, o.total_amount, o.order_status FROM Orders o JOIN Customer c ON o.customer_id = c.customer_id JOIN Product p ON o.product_id = p.product_id ORDER BY o.order_id;
