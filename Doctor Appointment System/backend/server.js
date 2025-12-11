require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// MySQL connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'doctor_appointments',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection
pool.getConnection()
    .then(connection => {
        console.log('MySQL Database connected successfully');
        connection.release();
    })
    .catch(err => {
        console.error('Database connection failed:', err);
    });

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Doctor Appointment System (MySQL)',
        database: 'MySQL'
    });
});

// Get all doctors
app.get('/api/doctors', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM doctors ORDER BY name');
        res.json(rows);
    } catch (err) {
        console.error('Error fetching doctors:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get available slots
app.get('/api/slots', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT s.*, d.name as doctor_name, d.specialization
            FROM slots s
            JOIN doctors d ON s.doctor_id = d.id
            WHERE s.available_seats > 0
            AND s.start_time > NOW()
            ORDER BY s.start_time
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching slots:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Book appointment with TRANSACTION and LOCKING
app.post('/api/book', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { slot_id, patient_name, patient_email, patient_phone, seats = 1 } = req.body;
        
        if (!slot_id || !patient_name) {
            return res.status(400).json({ 
                success: false,
                error: 'Slot ID and patient name are required' 
            });
        }
        
        await connection.beginTransaction();
        
        // LOCK the slot row for update
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
            // Update available seats
            await connection.query(
                'UPDATE slots SET available_seats = available_seats - ?, updated_at = NOW() WHERE id = ?',
                [seats, slot_id]
            );
            
            // Create booking
            const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
            const [result] = await connection.query(
                `INSERT INTO bookings 
                 (slot_id, patient_name, patient_email, patient_phone, seats_booked, expires_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED')`,
                [slot_id, patient_name, patient_email || null, patient_phone || null, seats, expiresAt]
            );
            
            await connection.commit();
            
            res.json({
                success: true,
                bookingId: result.insertId,
                message: 'Appointment booked successfully'
            });
            
        } else {
            await connection.rollback();
            res.status(409).json({
                success: false,
                error: 'Not enough seats available'
            });
        }
        
    } catch (err) {
        await connection.rollback();
        console.error('Booking error:', err);
        
        if (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') {
            res.status(409).json({
                success: false,
                error: 'Concurrent booking detected. Please try again.'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Booking failed due to system error'
            });
        }
    } finally {
        connection.release();
    }
});

// Get all bookings
app.get('/api/bookings', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT b.*, d.name as doctor_name, s.start_time
            FROM bookings b
            JOIN slots s ON b.slot_id = s.id
            JOIN doctors d ON s.doctor_id = d.id
            ORDER BY b.created_at DESC
            LIMIT 50
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching bookings:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Add doctor
app.post('/api/admin/doctors', async (req, res) => {
    try {
        const { name, specialization } = req.body;
        const [result] = await pool.query(
            'INSERT INTO doctors (name, specialization) VALUES (?, ?)',
            [name, specialization]
        );
        res.status(201).json({ id: result.insertId, name, specialization });
    } catch (err) {
        console.error('Error creating doctor:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Add slot
app.post('/api/admin/slots', async (req, res) => {
    try {
        const { doctor_id, start_time, end_time, max_patients } = req.body;
        const [result] = await pool.query(
            `INSERT INTO slots (doctor_id, start_time, end_time, max_patients, available_seats)
             VALUES (?, ?, ?, ?, ?)`,
            [doctor_id, start_time, end_time, max_patients, max_patients]
        );
        res.status(201).json({ 
            id: result.insertId, 
            doctor_id, 
            start_time, 
            end_time,
            available_seats: max_patients
        });
    } catch (err) {
        console.error('Error creating slot:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Clean expired bookings (cron job would call this)
app.post('/api/admin/cleanup', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Find expired pending bookings
        const [expiredBookings] = await connection.query(
            `SELECT id, slot_id, seats_booked 
             FROM bookings 
             WHERE status = 'PENDING' 
             AND expires_at < NOW()`
        );
        
        for (const booking of expiredBookings) {
            // Release seats
            await connection.query(
                'UPDATE slots SET available_seats = available_seats + ? WHERE id = ?',
                [booking.seats_booked, booking.slot_id]
            );
            
            // Mark as failed
            await connection.query(
                'UPDATE bookings SET status = ? WHERE id = ?',
                ['FAILED', booking.id]
            );
        }
        
        await connection.commit();
        res.json({ 
            success: true, 
            expired: expiredBookings.length,
            message: `Cleaned up ${expiredBookings.length} expired bookings`
        });
        
    } catch (err) {
        await connection.rollback();
        console.error('Cleanup error:', err);
        res.status(500).json({ error: 'Cleanup failed' });
    } finally {
        connection.release();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`MySQL database: ${process.env.DB_NAME || 'doctor_appointments'}`);
});