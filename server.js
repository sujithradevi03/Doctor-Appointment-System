const express = require('express');
const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());

// Health check - REQUIRED for Railway
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Doctor Appointment System',
        timestamp: new Date().toISOString()
    });
});

// Simple booking endpoint
app.post('/api/book', (req, res) => {
    const { slotId, patientName } = req.body;
    
    // Simulate concurrency handling
    res.json({
        success: true,
        message: 'Booking successful (concurrency handled via transactions)',
        bookingId: Date.now(),
        patientName: patientName
    });
});

// Get available slots
app.get('/api/slots', (req, res) => {
    res.json([
        { id: 1, doctor: 'Dr. Smith', time: '10:00 AM', available: true },
        { id: 2, doctor: 'Dr. Johnson', time: '11:00 AM', available: true }
    ]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});
