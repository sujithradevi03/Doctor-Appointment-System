-- Doctor Appointment System - MySQL Database Schema

-- Create database (run this first in MySQL Workbench)
CREATE DATABASE IF NOT EXISTS doctor_appointments;
USE doctor_appointments;

-- Doctors table
CREATE TABLE doctors (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    specialization VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_doctor_name (name)
) ENGINE=InnoDB;

-- Slots table
CREATE TABLE slots (
    id INT PRIMARY KEY AUTO_INCREMENT,
    doctor_id INT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    max_patients INT DEFAULT 1,
    available_seats INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    CHECK (end_time > start_time AND available_seats >= 0),
    INDEX idx_slots_doctor (doctor_id),
    INDEX idx_slots_time (start_time),
    INDEX idx_slots_available (available_seats)
) ENGINE=InnoDB;

-- Bookings table
CREATE TABLE bookings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    slot_id INT NOT NULL,
    patient_name VARCHAR(255) NOT NULL,
    patient_email VARCHAR(255),
    patient_phone VARCHAR(20),
    seats_booked INT NOT NULL CHECK (seats_booked > 0),
    status ENUM('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED') DEFAULT 'CONFIRMED',
    notes TEXT,
    expires_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE,
    INDEX idx_bookings_slot (slot_id),
    INDEX idx_bookings_status (status),
    INDEX idx_bookings_expires (expires_at)
) ENGINE=InnoDB;

-- Sample data
INSERT INTO doctors (name, specialization) VALUES
('Dr. Sarah Johnson', 'Cardiology'),
('Dr. Michael Chen', 'Dermatology'),
('Dr. Emily Williams', 'Pediatrics'),
('Dr. Robert Brown', 'Orthopedics');

INSERT INTO slots (doctor_id, start_time, end_time, max_patients, available_seats) VALUES
(1, '2024-12-15 09:00:00', '2024-12-15 09:30:00', 1, 1),
(1, '2024-12-15 10:00:00', '2024-12-15 10:30:00', 1, 1),
(2, '2024-12-15 11:00:00', '2024-12-15 11:30:00', 2, 2),
(3, '2024-12-15 14:00:00', '2024-12-15 14:30:00', 1, 1),
(4, '2024-12-16 09:00:00', '2024-12-16 09:30:00', 1, 1);

-- Stored procedure for booking with concurrency control
DELIMITER $$
CREATE PROCEDURE BookAppointment(
    IN p_slot_id INT,
    IN p_patient_name VARCHAR(255),
    IN p_patient_email VARCHAR(255),
    IN p_seats INT
)
BEGIN
    DECLARE v_available_seats INT;
    DECLARE v_booking_id INT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- Lock the slot row
    SELECT available_seats INTO v_available_seats
    FROM slots 
    WHERE id = p_slot_id 
    FOR UPDATE;
    
    IF v_available_seats >= p_seats THEN
        -- Reduce available seats
        UPDATE slots 
        SET available_seats = available_seats - p_seats
        WHERE id = p_slot_id;
        
        -- Create booking
        INSERT INTO bookings (slot_id, patient_name, patient_email, seats_booked, expires_at)
        VALUES (p_slot_id, p_patient_name, p_patient_email, p_seats, DATE_ADD(NOW(), INTERVAL 2 MINUTE));
        
        SET v_booking_id = LAST_INSERT_ID();
        
        COMMIT;
        
        SELECT 
            v_booking_id as booking_id,
            'CONFIRMED' as status,
            'Booking successful' as message;
    ELSE
        ROLLBACK;
        SELECT 
            NULL as booking_id,
            'FAILED' as status,
            'Not enough seats available' as message;
    END IF;
END$$
DELIMITER ;

-- View for available slots
CREATE VIEW available_slots AS
SELECT s.*, d.name as doctor_name, d.specialization
FROM slots s
JOIN doctors d ON s.doctor_id = d.id
WHERE s.available_seats > 0
AND s.start_time > NOW();

-- Trigger to update timestamp
DELIMITER $$
CREATE TRIGGER update_slot_timestamp
BEFORE UPDATE ON slots
FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END$$
DELIMITER ;