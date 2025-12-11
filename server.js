require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database connection
async function createPool() {
    if (process.env.DATABASE_URL) {
        console.log('Using DATABASE_URL from Railway');
        return mysql.createPool(process.env.DATABASE_URL);
    } else if (process.env.MYSQLHOST) {
        console.log('Using individual MySQL variables');
        return mysql.createPool({
            host: process.env.MYSQLHOST,
            user: process.env.MYSQLUSER,
            password: process.env.MYSQLPASSWORD,
            database: process.env.MYSQLDATABASE,
            port: process.env.MYSQLPORT,
            ssl: { rejectUnauthorized: false }
        });
    } else {
        console.log('Using local development connection');
        return mysql.createPool({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'doctor_appointments'
        });
    }
}

let pool;
createPool().then(p => {
    pool = p;
    console.log('Database pool created');
    initializeDatabase(); // Setup tables after connection
}).catch(err => {
    console.error('Failed to create database pool:', err);
});

// Initialize database tables
async function initializeDatabase() {
    if (!pool) return;
    
    try {
        await pool.query(`
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
                INDEX idx_available (available_seats),
                INDEX idx_time (start_time)
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
                INDEX idx_slot (slot_id),
                INDEX idx_status (status)
            );
        `);
        console.log('✅ Database tables created/verified');
        
        // Insert sample data if tables are empty
        const [doctorCount] = await pool.query('SELECT COUNT(*) as count FROM doctors');
        if (doctorCount[0].count === 0) {
            await pool.query(`
                INSERT INTO doctors (name, specialization) VALUES 
                ('Dr. Sarah Johnson', 'Cardiology'),
                ('Dr. Michael Chen', 'Dermatology'),
                ('Dr. Emily Williams', 'Pediatrics');
                
                INSERT INTO slots (doctor_id, start_time, end_time, available_seats) VALUES
                (1, DATE_ADD(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 1 DAY + INTERVAL 30 MINUTE), 1),
                (2, DATE_ADD(NOW(), INTERVAL 2 DAY), DATE_ADD(NOW(), INTERVAL 2 DAY + INTERVAL 30 MINUTE), 2),
                (3, DATE_ADD(NOW(), INTERVAL 3 DAY), DATE_ADD(NOW(), INTERVAL 3 DAY + INTERVAL 30 MINUTE), 1),
                (1, DATE_ADD(NOW(), INTERVAL 4 DAY), DATE_ADD(NOW(), INTERVAL 4 DAY + INTERVAL 30 MINUTE), 1),
                (2, DATE_ADD(NOW(), INTERVAL 5 DAY), DATE_ADD(NOW(), INTERVAL 5 DAY + INTERVAL 30 MINUTE), 1);
            `);
            console.log('✅ Sample data inserted');
        }
    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
    }
}

// ==================== API ENDPOINTS ====================

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: pool ? 'OK' : 'DB_CONNECTION_ERROR',
        service: 'Doctor Appointment System',
        timestamp: new Date().toISOString(),
        endpoints: {
            doctors: '/api/doctors',
            slots: '/api/slots',
            book: 'POST /api/book',
            bookings: '/api/bookings'
        }
    });
});

// Test database connection
app.get('/test-db', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ error: 'Database not connected' });
    }
    
    try {
        const [rows] = await pool.query('SELECT NOW() as time, DATABASE() as db_name, "Connected to Railway MySQL" as message');
        res.json({ 
            success: true,
            data: rows[0],
            connection: 'Railway MySQL working'
        });
    } catch (err) {
        res.status(500).json({ 
            error: err.message,
            hint: 'Check Railway MySQL connection variables'
        });
    }
});

// Add specific CORS configuration
const corsOptions = {
    origin: [
        'https://your-netlify-site.netlify.app',
        'http://localhost:3001',
        'http://localhost:3000'
    ],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// 1. Get all doctors
app.get('/api/doctors', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ error: 'Database not connected' });
    }
    
    try {
        const [doctors] = await pool.query('SELECT * FROM doctors ORDER BY name');
        res.json(doctors);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Get available slots
app.get('/api/slots', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ error: 'Database not connected' });
    }
    
    try {
        const [slots] = await pool.query(`
            SELECT s.*, d.name as doctor_name, d.specialization
            FROM slots s
            JOIN doctors d ON s.doctor_id = d.id
            WHERE s.available_seats > 0
            AND s.start_time > NOW()
            ORDER BY s.start_time
            LIMIT 20
        `);
        res.json(slots);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Book appointment WITH CONCURRENCY CONTROL
app.post('/api/book', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ error: 'Database not connected' });
    }
    
    const connection = await pool.getConnection();
    
    try {
        const { slot_id, patient_name, patient_email, patient_phone, seats = 1 } = req.body;
        
        // Validation
        if (!slot_id || !patient_name) {
            return res.status(400).json({ 
                success: false,
                error: 'Slot ID and patient name are required' 
            });
        }
        
        if (seats < 1) {
            return res.status(400).json({ 
                success: false,
                error: 'Must book at least 1 seat' 
            });
        }
        
        // START TRANSACTION WITH CONCURRENCY CONTROL
        await connection.beginTransaction();
        
        // 🔒 CRITICAL: Use FOR UPDATE to lock the row for concurrent requests
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
        
        // Check availability
        if (availableSeats >= seats) {
            // Update available seats (atomic operation within transaction)
            await connection.query(
                'UPDATE slots SET available_seats = available_seats - ? WHERE id = ?',
                [seats, slot_id]
            );
            
            // Create booking with expiration
            const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
            const [result] = await connection.query(
                `INSERT INTO bookings 
                 (slot_id, patient_name, patient_email, patient_phone, seats_booked, expires_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED')`,
                [slot_id, patient_name, patient_email || null, patient_phone || null, seats, expiresAt]
            );
            
            // Commit transaction
            await connection.commit();
            
            res.json({
                success: true,
                bookingId: result.insertId,
                message: 'Appointment booked successfully',
                concurrency: 'Prevented overbooking using MySQL FOR UPDATE lock',
                patientName: patient_name,
                seatsBooked: seats
            });
            
        } else {
            // Not enough seats available
            await connection.rollback();
            res.status(409).json({
                success: false,
                error: `Not enough seats available. Only ${availableSeats} seat(s) left.`,
                concurrency: 'Prevented overbooking - Concurrent request detected',
                available: availableSeats,
                requested: seats
            });
        }
        
    } catch (err) {
        // Rollback on any error
        await connection.rollback();
        console.error('Booking error:', err);
        
        // Handle specific concurrency errors
        if (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') {
            res.status(409).json({
                success: false,
                error: 'Concurrent booking detected. Please try again.',
                concurrency: 'Deadlock avoided via transaction rollback'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Booking failed: ' + err.message
            });
        }
    } finally {
        // Always release connection back to pool
        connection.release();
    }
});

// 4. Get all bookings
app.get('/api/bookings', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ error: 'Database not connected' });
    }
    
    try {
        const [bookings] = await pool.query(`
            SELECT b.*, d.name as doctor_name, s.start_time, s.available_seats
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

// 5. Admin: Add new doctor
app.post('/api/admin/doctors', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ error: 'Database not connected' });
    }
    
    try {
        const { name, specialization } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Doctor name is required' });
        }
        
        const [result] = await pool.query(
            'INSERT INTO doctors (name, specialization) VALUES (?, ?)',
            [name, specialization || 'General Physician']
        );
        
        res.json({
            success: true,
            doctorId: result.insertId,
            name,
            specialization: specialization || 'General Physician'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Admin: Add new slot
app.post('/api/admin/slots', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ error: 'Database not connected' });
    }
    
    try {
        const { doctor_id, start_time, end_time, max_patients = 1 } = req.body;
        
        if (!doctor_id || !start_time || !end_time) {
            return res.status(400).json({ error: 'Doctor ID, start time, and end time are required' });
        }
        
        const [result] = await pool.query(
            `INSERT INTO slots (doctor_id, start_time, end_time, max_patients, available_seats)
             VALUES (?, ?, ?, ?, ?)`,
            [doctor_id, start_time, end_time, max_patients, max_patients]
        );
        
        res.json({
            success: true,
            slotId: result.insertId,
            doctor_id,
            start_time,
            available_seats: max_patients
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        available: {
            health: 'GET /health',
            doctors: 'GET /api/doctors',
            slots: 'GET /api/slots',
            book: 'POST /api/book',
            bookings: 'GET /api/bookings'
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: /health`);
    console.log(`🎯 Available endpoints:`);
    console.log(`   GET  /api/doctors    - List all doctors`);
    console.log(`   GET  /api/slots      - List available slots`);
    console.log(`   POST /api/book       - Book appointment (concurrency handled)`);
    console.log(`   GET  /api/bookings   - List all bookings`);
    console.log(`✨ Concurrency control: MySQL FOR UPDATE locking + Transactions`);
});
