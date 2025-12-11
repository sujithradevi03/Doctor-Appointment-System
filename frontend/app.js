// Configuration - UPDATE THIS WITH YOUR RAILWAY URL
const BACKEND_URL = 'https://YOUR-APP-NAME.up.railway.app'; // ← CHANGE THIS

// Tab switching
function showTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.add('hidden');
    });
    
    // Remove active from all buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(`${tabName}-tab`).classList.remove('hidden');
    
    // Activate button
    event.target.classList.add('active');
    
    // Load data if needed
    if (tabName === 'view') {
        loadData();
    }
}

// Load all data
async function loadData() {
    try {
        // Load doctors
        const doctorsRes = await fetch(`${BACKEND_URL}/api/doctors`);
        const doctors = await doctorsRes.json();
        
        // Load slots
        const slotsRes = await fetch(`${BACKEND_URL}/api/slots`);
        const slots = await slotsRes.json();
        
        // Display data
        displayDoctors(doctors);
        displaySlots(slots);
        
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('slots-list').innerHTML = 
            '<div class="error">Failed to load data. Check backend connection.</div>';
    }
}

function displayDoctors(doctors) {
    const container = document.getElementById('doctors-list');
    container.innerHTML = doctors.map(doctor => `
        <div class="card">
            <h3>${doctor.name}</h3>
            <p>Specialization: ${doctor.specialization || 'General'}</p>
        </div>
    `).join('');
}

function displaySlots(slots) {
    const container = document.getElementById('slots-list');
    
    if (slots.length === 0) {
        container.innerHTML = '<div class="card">No available slots</div>';
        return;
    }
    
    container.innerHTML = slots.map(slot => `
        <div class="card">
            <h3>Dr. ${slot.doctor_name}</h3>
            <p>Specialty: ${slot.specialization}</p>
            <p>Time: ${new Date(slot.start_time).toLocaleString()}</p>
            <p class="available">Available seats: ${slot.available_seats}</p>
            <button class="btn" onclick="bookSlot(${slot.id})">
                Book Appointment
            </button>
        </div>
    `).join('');
}

// Book a slot
async function bookSlot(slotId) {
    const patientName = prompt("Enter your name:");
    if (!patientName) return;
    
    const patientEmail = prompt("Enter your email (optional):");
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/book`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                slot_id: slotId,
                patient_name: patientName,
                patient_email: patientEmail || '',
                seats: 1
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`✅ Appointment booked successfully!\nBooking ID: ${result.bookingId}`);
            loadData(); // Refresh data
        } else {
            alert(`❌ Booking failed: ${result.error}`);
        }
    } catch (error) {
        alert('Error booking appointment. Please try again.');
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Set default tab
    showTab('view');
    
    // Test backend connection
    fetch(`${BACKEND_URL}/health`)
        .then(res => res.json())
        .then(data => {
            console.log('Backend connected:', data);
        })
        .catch(err => {
            console.error('Backend connection failed:', err);
        });
});
