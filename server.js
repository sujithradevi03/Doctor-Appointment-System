const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Use Railway's MySQL connection URL
const pool = mysql.createPool(process.env.DATABASE_URL || 'mysql://root:********@yamabiko.proxy.rlwy.net:58062/railway');

// Auto-create tables on startup
async function initializeDatabase() {
    const createTables = `
        CREATE TABLE IF NOT EXISTS doctors (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            specialization VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS slots (
            id INT AUTO_INCREMENT PRIMARY KEY,
            doctor_id INT,
            start_time DATETIME,
            end_time DATETIME,
            max_patients INT DEFAULT 1,
            available_seats INT DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id)
        );
        
        CREATE TABLE IF NOT EXISTS bookings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            slot_id INT,
            patient_name VARCHAR(255) NOT NULL,
            patient_email VARCHAR(255),
            patient_phone VARCHAR(20),
            seats_booked INT DEFAULT 1,
            status ENUM('PENDING', 'CONFIRMED', 'FAILED') DEFAULT 'CONFIRMED',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            FOREIGN KEY (slot_id) REFERENCES slots(id)
        );
    `;
    
    try {
        await pool.query(createTables);
        console.log('✅ Database tables created/verified');
        
        // Insert sample data if empty
        const [doctors] = await pool.query('SELECT COUNT(*) as count FROM doctors');
        if (doctors[0].count === 0) {
            await pool.query(`
                INSERT INTO doctors (name, specialization) VALUES 
                ('Dr. Sarah Johnson', 'Cardiology'),
                ('Dr. Michael Chen', 'Dermatology'),
                ('Dr. Emily Williams', 'Pediatrics');
                
                INSERT INTO slots (doctor_id, start_time, end_time, available_seats) VALUES
                (1, DATE_ADD(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 1 DAY + INTERVAL 30 MINUTE), 1),
                (2, DATE_ADD(NOW(), INTERVAL 2 DAY), DATE_ADD(NOW(), INTERVAL 2 DAY + INTERVAL 30 MINUTE), 2),
                (3, DATE_ADD(NOW(), INTERVAL 3 DAY), DATE_ADD(NOW(), INTERVAL 3 DAY + INTERVAL 30 MINUTE), 1);
            `);
            console.log('✅ Sample data inserted');
        }
    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
    }
}

// Initialize database when server starts
initializeDatabase();

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        service: 'Doctor Appointment System',
        database: 'MySQL on Railway',
        timestamp: new Date().toISOString()
    });
});

// Test database connection
app.get('/test-db', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1 + 1 AS result, NOW() as time');
        res.json({ 
            success: true,
            message: 'Database connected successfully',
            result: rows[0],
            connection: 'Railway MySQL'
        });
    } catch (err) {
        res.status(500).json({ 
            success: false,
            error: err.message,
            connection: 'Failed to connect to MySQL'
        });
    }
});

// Get all doctors
app.get('/api/doctors', async (req, res) => {
    try {
        const [doctors] = await pool.query('SELECT * FROM doctors ORDER BY name');
        res.json(doctors);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get available slots
app.get('/api/slots', async (req, res) => {
    try {
        const [slots] = await pool.query(`
            SELECT s.*, d.name as doctor_name, d.specialization
            FROM slots s
            JOIN doctors d ON s.doctor_id = d.id
            WHERE s.available_seats > 0
            AND s.start_time > NOW()
            ORDER BY s.start_time
        `);
        res.json(slots);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// BOOK APPOINTMENT WITH CONCURRENCY CONTROL
app.post('/api/book', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { slot_id, patient_name, patient_email, seats = 1 } = req.body;
        
        if (!slot_id || !patient_name) {
            return res.status(400).json({ 
                success: false,
                error: 'Slot ID and patient name are required' 
            });
        }
        
        // START TRANSACTION WITH ISOLATION LEVEL
        await connection.beginTransaction();
        
        // LOCK the slot row using SELECT FOR UPDATE
        const [slotRows] = await connection.query(
            'SELECT available_seats FROM slots WHERE id = ? FOR UPDATE',
            [slot_id]
        );
        
        if (slotRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                error: 'Slot not found'
            });
        }
        
        const availableSeats = slotRows[0].available_seats;
        
        if (availableSeats >= seats) {
            // Update available seats (concurrency safe)
            await connection.query(
                'UPDATE slots SET available_seats = available_seats - ? WHERE id = ?',
                [seats, slot_id]
            );
            
            // Create booking
            const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
            const [result] = await connection.query(
                `INSERT INTO bookings 
                 (slot_id, patient_name, patient_email, seats_booked, expires_at, status)
                 VALUES (?, ?, ?, ?, ?, 'CONFIRMED')`,
                [slot_id, patient_name, patient_email || null, seats, expiresAt]
            );
            
            await connection.commit();
            
            res.json({
                success: true,
                bookingId: result.insertId,
                message: 'Appointment booked successfully',
                concurrency: 'Handled via MySQL FOR UPDATE lock'
            });
            
        } else {
            await connection.rollback();
            res.status(409).json({
                success: false,
                error: 'Not enough seats available. Already booked by another user.',
                concurrency: 'Prevented overbooking'
            });
        }
        
    } catch (err) {
        await connection.rollback();
        console.error('Booking error:', err);
        
        // Handle concurrency errors
        if (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') {
            res.status(409).json({
                success: false,
                error: 'Concurrent booking detected. Please try again.',
                concurrency: 'Deadlock avoided'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Booking failed: ' + err.message
            });
        }
    } finally {
        connection.release();
    }
});

// Get all bookings
app.get('/api/bookings', async (req, res) => {
    try {
        const [bookings] = await pool.query(`
            SELECT b.*, d.name as doctor_name, s.start_time
            FROM bookings b
            JOIN slots s ON b.slot_id = s.id
            JOIN doctors d ON s.doctor_id = d.id
            ORDER BY b.created_at DESC
            LIMIT 20
        `);
        res.json(bookings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: /health`);
    console.log(`🔗 MySQL Database: Railway`);
});
