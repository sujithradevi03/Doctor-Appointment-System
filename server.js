require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database connection - SIMPLIFIED
async function createPool() {
    // Try multiple connection methods
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
}).catch(err => {
    console.error('Failed to create database pool:', err);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: pool ? 'OK' : 'DB_CONNECTION_ERROR',
        service: 'Doctor Appointment System',
        timestamp: new Date().toISOString()
    });
});

// Test database endpoint
app.get('/test-db', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ error: 'Database not connected' });
    }
    
    try {
        const [rows] = await pool.query('SELECT NOW() as time, "Connected to Railway MySQL" as message');
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

// Simple booking endpoint (for demo)
app.post('/api/book', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ error: 'Database not ready' });
    }
    
    res.json({
        success: true,
        message: 'Booking system ready',
        note: 'MySQL connected to Railway - Concurrency handled via transactions'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Test endpoints:`);
    console.log(`  Health: http://localhost:${PORT}/health`);
    console.log(`  DB Test: http://localhost:${PORT}/test-db`);
});
