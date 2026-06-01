/**
 * booking.js — JavaScript for public booking pages (book_meeting.html & booking_confirmed.html).
 * No auth dependency — uses raw fetch() without JWT.
 * Handles: token validation, booking form submission, confirmation loading.
 */

const API_BASE = window.location.origin;

// ──────────────────────────────────────────────
//  Page Router — detect which page we're on
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;

    if (path.includes('book-meeting')) {
        validateBookingLink();
    } else if (path.includes('booking-confirmed')) {
        loadConfirmation();
    }
});

// ──────────────────────────────────────────────
//  Validate Booking Link (book_meeting.html)
// ──────────────────────────────────────────────
async function validateBookingLink() {
    const params = new URLSearchParams(window.location.search);
    const leadId = params.get('lead_id');
    const token = params.get('token');

    const loadingEl = document.getElementById('loadingState');
    const errorEl = document.getElementById('errorState');
    const formEl = document.getElementById('bookingForm');

    if (!leadId || !token) {
        showBookingError('Invalid Link', 'This booking link is incomplete. Please use the link from your email.');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/booking/validate?lead_id=${leadId}&token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (!data.valid) {
            showBookingError('Booking Unavailable', data.reason || 'This booking link is not valid.');
            return;
        }

        // Populate form with lead data
        const titleInput = document.getElementById('bookTitle');
        const clientNameInput = document.getElementById('bookClientName');
        const clientEmailInput = document.getElementById('bookClientEmail');
        const contactDisplay = document.getElementById('displayContactName');
        const companyDisplay = document.getElementById('displayCompanyName');
        const subtitle = document.getElementById('bookingSubtitle');

        if (data.contact_name) {
            if (clientNameInput) clientNameInput.value = data.contact_name;
            if (contactDisplay) contactDisplay.textContent = data.contact_name;
        }

        if (data.company_name) {
            if (companyDisplay) companyDisplay.textContent = data.company_name;
            if (titleInput) titleInput.value = `Meeting with ${data.company_name}`;
        } else if (data.contact_name) {
            if (titleInput) titleInput.value = `Meeting with ${data.contact_name}`;
        }

        if (data.email) {
            if (clientEmailInput) clientEmailInput.value = data.email;
        }

        if (data.salesperson_name && subtitle) {
            subtitle.textContent = `Schedule a meeting with ${data.salesperson_name}`;
        }

        // Set min date to today
        const dateInput = document.getElementById('bookDate');
        if (dateInput) {
            const today = new Date();
            dateInput.min = today.toISOString().slice(0, 10);
            // Default to tomorrow
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            dateInput.value = tomorrow.toISOString().slice(0, 10);
        }

        // Default time to next round hour
        const timeInput = document.getElementById('bookTime');
        if (timeInput) {
            const now = new Date();
            now.setHours(now.getHours() + 1);
            now.setMinutes(0);
            timeInput.value = now.toTimeString().slice(0, 5);
        }

        // Fetch office hours and restrict time picker
        try {
            const ohRes = await fetch(`${API_BASE}/api/booking/office-hours`);
            if (ohRes.ok) {
                const oh = await ohRes.json();
                if (timeInput) {
                    timeInput.min = oh.start_time;
                    timeInput.max = oh.end_time;
                }
                // Add office hours info text after the time input
                if (timeInput && timeInput.parentElement) {
                    const infoText = document.createElement('div');
                    infoText.style.cssText = 'font-size:0.75rem;color:#6B7280;margin-top:4px;';
                    infoText.textContent = `🕐 Office Hours: ${oh.start_time} – ${oh.end_time} IST`;
                    timeInput.parentElement.appendChild(infoText);
                }
            }
        } catch (_) {}

        // Show form, hide loading
        if (loadingEl) loadingEl.style.display = 'none';
        if (formEl) formEl.style.display = 'block';

    } catch (err) {
        console.error('Validation error:', err);
        showBookingError('Connection Error', 'Could not connect to the server. Please try again later.');
    }
}

// ──────────────────────────────────────────────
//  Submit Booking Form
// ──────────────────────────────────────────────
async function submitBooking() {
    const params = new URLSearchParams(window.location.search);
    const leadId = params.get('lead_id');
    const token = params.get('token');
    const btn = document.getElementById('bookSubmitBtn');

    // Gather form values
    const title = document.getElementById('bookTitle').value.trim();
    const date = document.getElementById('bookDate').value;
    const time = document.getElementById('bookTime').value;
    const duration = parseInt(document.getElementById('bookDuration').value);
    const clientName = document.getElementById('bookClientName').value.trim();
    const clientEmail = document.getElementById('bookClientEmail').value.trim();
    const notes = document.getElementById('bookNotes').value.trim();

    // ── Validation ──
    if (!title) { showBookingToast('Please enter a meeting title', 'error'); return; }
    if (!date) { showBookingToast('Please select a date', 'error'); return; }
    if (!time) { showBookingToast('Please select a time', 'error'); return; }
    if (!clientName) { showBookingToast('Please enter your name', 'error'); return; }
    if (!clientEmail) { showBookingToast('Please enter your email', 'error'); return; }

    // Validate email format
    if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(clientEmail)) {
        showBookingToast('Please enter a valid email address', 'error');
        return;
    }

    // Validate date is not in the past
    const selectedDate = new Date(`${date}T${time}:00`);
    if (selectedDate <= new Date()) {
        showBookingToast('Please select a future date and time', 'error');
        return;
    }

    // Disable button
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="booking-btn-spinner"></span> Booking...';
    }

    try {
        const startDatetime = `${date}T${time}:00`;

        const res = await fetch(`${API_BASE}/api/booking/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lead_id: parseInt(leadId),
                token: token,
                title: title,
                start_datetime: startDatetime,
                duration_minutes: duration,
                notes: notes,
                client_name: clientName,
                client_email: clientEmail,
            }),
        });

        const data = await res.json();

        if (res.ok && data.success) {
            // Redirect to confirmation page
            window.location.href = `/booking-confirmed?lead_id=${leadId}`;
        } else {
            showBookingToast(data.detail || data.message || 'Failed to book meeting. Please try again.', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '📅 Book Meeting';
            }
        }
    } catch (err) {
        console.error('Booking error:', err);
        showBookingToast('Connection error. Please check your internet and try again.', 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '📅 Book Meeting';
        }
    }
}

// ──────────────────────────────────────────────
//  Load Confirmation (booking_confirmed.html)
// ──────────────────────────────────────────────
async function loadConfirmation() {
    const params = new URLSearchParams(window.location.search);
    const leadId = params.get('lead_id');

    const loadingEl = document.getElementById('loadingState');
    const confirmEl = document.getElementById('confirmContent');

    if (!leadId) {
        if (loadingEl) loadingEl.innerHTML = '<p style="color:#DC2626;">Invalid confirmation link.</p>';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/booking/confirmation/${leadId}`);

        if (!res.ok) {
            if (loadingEl) loadingEl.innerHTML = '<p style="color:#DC2626;">Could not load meeting details.</p>';
            return;
        }

        const data = await res.json();

        // Populate confirmation details
        const titleEl = document.getElementById('confTitle');
        const dateTimeEl = document.getElementById('confDateTime');
        const durationEl = document.getElementById('confDuration');

        if (titleEl) titleEl.textContent = data.title || 'Meeting';

        if (dateTimeEl && data.start_datetime) {
            const dt = new Date(data.start_datetime);
            const dateStr = dt.toLocaleDateString('en-IN', {
                weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
            });
            const timeStr = dt.toLocaleTimeString('en-IN', {
                hour: '2-digit', minute: '2-digit', hour12: true
            });
            dateTimeEl.textContent = `${dateStr} at ${timeStr}`;
        }

        if (durationEl) {
            durationEl.textContent = `${data.duration_minutes || 60} minutes`;
        }

        // Google Meet link
        if (data.meet_link) {
            const meetSection = document.getElementById('meetLinkSection');
            const meetLink = document.getElementById('confMeetLink');
            if (meetSection) meetSection.style.display = 'block';
            if (meetLink) {
                meetLink.href = data.meet_link;
                meetLink.textContent = data.meet_link;
            }
        }

        // Calendar link
        if (data.event_link) {
            const calSection = document.getElementById('calendarLinkSection');
            const calLink = document.getElementById('confCalendarLink');
            if (calSection) calSection.style.display = 'block';
            if (calLink) calLink.href = data.event_link;
        }

        // Show confirmation, hide loading
        if (loadingEl) loadingEl.style.display = 'none';
        if (confirmEl) confirmEl.style.display = 'block';

    } catch (err) {
        console.error('Confirmation load error:', err);
        if (loadingEl) loadingEl.innerHTML = '<p style="color:#DC2626;">Failed to load confirmation. Please check your email for the calendar invite.</p>';
    }
}

// ──────────────────────────────────────────────
//  Copy Google Meet Link
// ──────────────────────────────────────────────
function copyMeetLink() {
    const meetLink = document.getElementById('confMeetLink');
    const btn = document.getElementById('copyMeetBtn');
    if (!meetLink) return;

    const link = meetLink.href;

    const doFallback = () => {
        try {
            const el = document.createElement('textarea');
            el.value = link;
            el.style.position = 'fixed';
            el.style.opacity = '0';
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            showBookingToast('Meet link copied!', 'success');
            if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000); }
        } catch (_) {
            showBookingToast('Could not copy. Please copy manually.', 'error');
        }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(() => {
            showBookingToast('Meet link copied to clipboard!', 'success');
            if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000); }
        }).catch(doFallback);
    } else {
        doFallback();
    }
}

// ──────────────────────────────────────────────
//  Helper: Show Booking Error State
// ──────────────────────────────────────────────
function showBookingError(title, message) {
    const loadingEl = document.getElementById('loadingState');
    const errorEl = document.getElementById('errorState');
    const formEl = document.getElementById('bookingForm');

    if (loadingEl) loadingEl.style.display = 'none';
    if (formEl) formEl.style.display = 'none';

    const errorTitle = document.getElementById('errorTitle');
    const errorMsg = document.getElementById('errorMessage');

    if (errorTitle) errorTitle.textContent = title;
    if (errorMsg) errorMsg.textContent = message;
    if (errorEl) errorEl.style.display = 'flex';
}

// ──────────────────────────────────────────────
//  Helper: Toast Notification (standalone for public pages)
//  Now also shows inline error near the submit button
// ──────────────────────────────────────────────
function showBookingToast(message, type = 'success') {
    // --- Inline error near the button (for error type) ---
    const inlineError = document.getElementById('bookingInlineError');
    if (inlineError) {
        if (type === 'error') {
            inlineError.innerHTML = `<span class="booking-inline-error-icon">❌</span><span>${message}</span>`;
            inlineError.style.display = 'flex';
            // Smooth scroll the inline error into view
            inlineError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Auto-hide after 8 seconds
            clearTimeout(inlineError._hideTimeout);
            inlineError._hideTimeout = setTimeout(() => {
                inlineError.style.display = 'none';
            }, 8000);
            return; // Don't show the floating toast for errors
        } else {
            inlineError.style.display = 'none';
        }
    }

    // --- Floating toast (only for success/info) ---
    const existing = document.querySelector('.booking-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `booking-toast booking-toast-${type}`;
    toast.innerHTML = `
        <span>${type === 'success' ? '✅' : 'ℹ️'}</span>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}
