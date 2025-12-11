// Configuration
const BACKEND_URL = 'http://localhost:3000';
// For deployment, change to your deployed backend URL:
// const BACKEND_URL = 'https://your-backend-url.onrender.com';

// DOM Elements
const elements = {
    doctorsList: document.getElementById('doctors-list'),
    slotsList: document.getElementById('slots-list'),
    bookingsList: document.getElementById('bookings-list'),
    bookingForm: document.getElementById('booking-form'),
    addDoctorForm: document.getElementById('add-doctor-form'),
    addSlotForm: document.getElementById('add-slot-form'),
    slotSelect: document.getElementById('slot-select'),
    doctorSelect: document.getElementById('doctor-select'),
    bookingResult: document.getElementById('booking-result'),
    resultMessage: document.getElementById('result-message'),
    backendStatus: document.getElementById('backend-status')
};

// Tab switching
function showTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Remove active class from all buttons
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    // Activate button
    event.target.classList.add('active');
    
    // Refresh data if needed
    if (tabName === 'view') {
        loadAllData();
    }
}

// Load all data for view tab
async function loadAllData() {
    try {
        await checkBackendStatus();
        await loadDoctors();
        await loadSlots();
        await loadBookings();
        await loadSlotsForBooking();
        await loadDoctorsForAdmin();
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Check backend status
async function checkBackendStatus() {
    try {
        const response = await fetch(`${BACKEND_URL}/health`);
        if (response.ok) {
            elements.backendStatus.textContent = 'Online';
            elements.backendStatus.className = 'status online';
        } else {
            throw new Error('Backend not responding');
        }
    } catch (error) {
        elements.backendStatus.textContent = 'Offline';
        elements.backendStatus.className = 'status offline';
    }
}

// Load doctors
async function loadDoctors() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/doctors`);
        const doctors = await response.json();
        
        elements.doctorsList.innerHTML = doctors.map(doctor => `
            <div class="card">
                <h3>${doctor.name}</h3>
                <p><i class="fas fa-user-md"></i> ${doctor.specialization || 'General Physician'}</p>
                <p><i class="fas fa-calendar-alt"></i> Joined: ${new Date(doctor.created_at).toLocaleDateString()}</p>
            </div>
        `).join('');
    } catch (error) {
        elements.doctorsList.innerHTML = '<div class="error">Failed to load doctors</div>';
    }
}

// Load available slots
async function loadSlots() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/slots`);
        const slots = await response.json();
        
        if (slots.length === 0) {
            elements.slotsList.innerHTML = '<div class="card"><p>No available slots at the moment</p></div>';
            return;
        }
        
        elements.slotsList.innerHTML = slots.map(slot => `
            <div class="card">
                <h3>Dr. ${slot.doctor_name}</h3>
                <p><i class="fas fa-stethoscope"></i> ${slot.specialization}</p>
                <p><i class="fas fa-clock"></i> ${formatDateTime(slot.start_time)} - ${formatTime(slot.end_time)}</p>
                <p class="available"><i class="fas fa-chair"></i> Available seats: ${slot.available_seats}</p>
                <button onclick="bookSlot(${slot.id})" class="btn-primary" style="margin-top: 10px;">
                    Book Now
                </button>
            </div>
        `).join('');
    } catch (error) {
        elements.slotsList.innerHTML = '<div class="error">Failed to load slots</div>';
    }
}

// Load slots for booking form dropdown
async function loadSlotsForBooking() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/slots`);
        const slots = await response.json();
        
        elements.slotSelect.innerHTML = '<option value="">Select a time slot</option>' +
            slots.map(slot => `
                <option value="${slot.id}">
                    Dr. ${slot.doctor_name} - ${slot.specialization} | 
                    ${formatDateTime(slot.start_time)} | 
                    Available: ${slot.available_seats} seats
                </option>
            `).join('');
    } catch (error) {
        elements.slotSelect.innerHTML = '<option value="">Failed to load slots</option>';
    }
}

// Load doctors for admin form
async function loadDoctorsForAdmin() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/doctors`);
        const doctors = await response.json();
        
        elements.doctorSelect.innerHTML = '<option value="">Select a doctor</option>' +
            doctors.map(doctor => `
                <option value="${doctor.id}">
                    ${doctor.name} - ${doctor.specialization}
                </option>
            `).join('');
    } catch (error) {
        elements.doctorSelect.innerHTML = '<option value="">Failed to load doctors</option>';
    }
}

// Load recent bookings
async function loadBookings() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/bookings`);
        const bookings = await response.json();
        
        if (bookings.length === 0) {
            elements.bookingsList.innerHTML = '<div class="card"><p>No bookings yet</p></div>';
            return;
        }
        
        elements.bookingsList.innerHTML = bookings.map(booking => `
            <div class="card">
                <h3>Booking #${booking.id}</h3>
                <p><i class="fas fa-user"></i> Patient: ${booking.patient_name}</p>
                <p><i class="fas fa-envelope"></i> ${booking.patient_email || 'No email'}</p>
                <p><i class="fas fa-user-md"></i> Doctor: ${booking.doctor_name}</p>
                <p><i class="fas fa-calendar"></i> ${formatDateTime(booking.start_time)}</p>
                <p><i class="fas fa-ticket-alt"></i> Seats: ${booking.seats_booked}</p>
                <p class="${booking.status === 'CONFIRMED' ? 'available' : 'booked'}">
                    <i class="fas fa-${booking.status === 'CONFIRMED' ? 'check-circle' : 'times-circle'}"></i>
                    Status: ${booking.status}
                </p>
            </div>
        `).join('');
    } catch (error) {
        elements.bookingsList.innerHTML = '<div class="error">Failed to load bookings</div>';
    }
}

// Handle booking form submission
elements.bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const bookingData = {
        slot_id: parseInt(elements.slotSelect.value),
        patient_name: document.getElementById('patient-name').value,
        patient_email: document.getElementById('patient-email').value,
        seats: parseInt(document.getElementById('seats').value) || 1
    };
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/book`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bookingData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            elements.resultMessage.innerHTML = `
                <div class="success">
                    <h4><i class="fas fa-check-circle"></i> Appointment Booked Successfully!</h4>
                    <p>Booking ID: ${result.bookingId}</p>
                    <p>${result.message}</p>
                </div>
            `;
            
            // Clear form
            elements.bookingForm.reset();
            
            // Refresh data
            loadSlots();
            loadBookings();
            loadSlotsForBooking();
            
        } else {
            elements.resultMessage.innerHTML = `
                <div class="error">
                    <h4><i class="fas fa-exclamation-circle"></i> Booking Failed</h4>
                    <p>${result.error}</p>
                </div>
            `;
        }
        
        elements.bookingResult.classList.remove('hidden');
        
    } catch (error) {
        elements.resultMessage.innerHTML = `
            <div class="error">
                <h4><i class="fas fa-exclamation-circle"></i> Network Error</h4>
                <p>Unable to connect to server. Please try again later.</p>
            </div>
        `;
        elements.bookingResult.classList.remove('hidden');
    }
});

// Handle add doctor form
elements.addDoctorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const doctorData = {
        name: document.getElementById('doctor-name').value,
        specialization: document.getElementById('specialization').value
    };
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/doctors`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(doctorData)
        });
        
        if (response.ok) {
            alert('Doctor added successfully!');
            elements.addDoctorForm.reset();
            loadDoctors();
            loadDoctorsForAdmin();
        } else {
            alert('Failed to add doctor');
        }
    } catch (error) {
        alert('Error adding doctor');
    }
});

// Handle add slot form
elements.addSlotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const slotData = {
        doctor_id: parseInt(elements.doctorSelect.value),
        start_time: document.getElementById('start-time').value,
        end_time: document.getElementById('end-time').value,
        max_patients: parseInt(document.getElementById('max-patients').value)
    };
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/slots`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(slotData)
        });
        
        if (response.ok) {
            alert('Time slot added successfully!');
            elements.addSlotForm.reset();
            loadSlots();
            loadSlotsForBooking();
        } else {
            alert('Failed to add time slot');
        }
    } catch (error) {
        alert('Error adding time slot');
    }
});

// Book slot directly from view
async function bookSlot(slotId) {
    const patientName = prompt("Enter patient name:");
    if (!patientName) return;
    
    const patientEmail = prompt("Enter patient email (optional):");
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/book`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                slot_id: slotId,
                patient_name: patientName,
                patient_email: patientEmail,
                seats: 1
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`Appointment booked successfully!\nBooking ID: ${result.bookingId}`);
            loadAllData();
        } else {
            alert(`Booking failed: ${result.error}`);
        }
    } catch (error) {
        alert('Error booking appointment');
    }
}

// Reset booking form
function resetForm() {
    elements.bookingResult.classList.add('hidden');
    showTab('book');
}

// Format date and time
function formatDateTime(dateTimeString) {
    const date = new Date(dateTimeString);
    return date.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatTime(dateTimeString) {
    const date = new Date(dateTimeString);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadAllData();
    // Set current time for datetime-local inputs
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    const currentDateTime = `${year}-${month}-${day}T${hours}:${minutes}`;
    document.getElementById('start-time').value = currentDateTime;
    document.getElementById('end-time').value = currentDateTime;
    
    // Auto-refresh every 30 seconds
    setInterval(loadAllData, 30000);
});