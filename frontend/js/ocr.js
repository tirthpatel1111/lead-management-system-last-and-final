/**
 * ocr.js — OCR scanning page logic.
 * Handles image upload, OCR extraction, data review, and saving as lead.
 */

let selectedFile = null;

document.addEventListener('DOMContentLoaded', () => {
    setupOCR();
});

function setupOCR() {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('cardFileInput');
    const btnScan = document.getElementById('btnScan');
    const btnSave = document.getElementById('btnSaveLead');
    const btnReset = document.getElementById('btnResetOCR');

    // Click to select file
    uploadZone.addEventListener('click', () => fileInput.click());

    // File selected
    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    });

    // Drag and drop
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = '#2563EB';
        uploadZone.style.background = '#EFF6FF';
    });

    uploadZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = '';
        uploadZone.style.background = '';
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = '';
        uploadZone.style.background = '';
        if (e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    // Scan button
    btnScan.addEventListener('click', scanCard);

    // Save as lead
    btnSave.addEventListener('click', saveAsLead);

    // Reset
    btnReset.addEventListener('click', () => {
        selectedFile = null;
        fileInput.value = '';
        document.getElementById('imagePreview').classList.add('hidden');
        document.getElementById('scanBtnContainer').classList.add('hidden');
        document.getElementById('extractedCard').classList.add('hidden');
        uploadZone.style.display = '';
    });
}

function handleFile(file) {
    selectedFile = file;

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('previewImg').src = e.target.result;
        document.getElementById('imagePreview').classList.remove('hidden');
        document.getElementById('scanBtnContainer').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

async function scanCard() {
    if (!selectedFile) {
        showToast('Please select an image first', 'error');
        return;
    }

    const btnScan = document.getElementById('btnScan');
    btnScan.disabled = true;

    const formData = new FormData();
    formData.append('file', selectedFile);

    // Create full-screen processing overlay with indeterminate progress bar
    const overlay = document.createElement('div');
    overlay.className = 'bulk-progress-overlay';
    overlay.innerHTML = `
        <div class="bulk-progress-card">
            <div class="bulk-spinner"></div>
            <div class="bulk-progress-icon">📷</div>
            <h2 class="bulk-progress-title">Processing Image</h2>
            <p class="bulk-progress-subtitle">Analyzing visiting card...</p>
            <div class="bulk-progress-bar-container">
                <div class="bulk-progress-bar-fill indeterminate"></div>
            </div>
            <div class="bulk-progress-counter">Processing...</div>
            <p class="bulk-progress-warning">⚠️ Please do not close this page or navigate away.</p>
        </div>
    `;
    document.body.appendChild(overlay);

    try {
        const res = await apiUpload('/api/leads/upload/ocr', formData);
        const data = await res.json();

        // Remove overlay on completion
        overlay.remove();

        if (res.ok) {
            const extracted = data.extracted;

            // Populate form with extracted data
            document.getElementById('ocrCompany').value = extracted.company_name || '';
            document.getElementById('ocrContact').value = extracted.contact_name || '';
            document.getElementById('ocrEmail').value = extracted.email || '';
            document.getElementById('ocrPhone').value = extracted.phone || '';
            document.getElementById('ocrRawText').value = extracted.raw_text || '';

            // Show extracted data card
            document.getElementById('extractedCard').classList.remove('hidden');
            showToast('Card scanned successfully! Review the data below.', 'success');
        } else {
            showToast(data.detail || 'OCR scan failed', 'error');
        }
    } catch (err) {
        overlay.remove();
        showToast('Scan failed: ' + err.message, 'error');
    }

    btnScan.disabled = false;
    btnScan.textContent = '🔍 Scan & Extract Data';
}

async function saveAsLead() {
    const body = {
        company_name: document.getElementById('ocrCompany').value || null,
        contact_name: document.getElementById('ocrContact').value || null,
        email: document.getElementById('ocrEmail').value || null,
        phone: document.getElementById('ocrPhone').value || null,
        source: 'ocr',
        notes: 'Extracted from visiting card via OCR',
    };

    if (!body.email) {
        showToast('Email is required to save this lead', 'error');
        return;
    }

    if (!isValidEmail(body.email)) {
        showToast('Please enter a valid email (e.g., john@company.com)', 'error');
        return;
    }
    if (body.phone && !isValidPhone(body.phone)) {
        showToast('Invalid phone. Use: 1234567890, +911234567890, or +91 1234567890', 'error');
        return;
    }

    const btnSave = document.getElementById('btnSaveLead');
    withLoadingState(btnSave, 'Saving...', async () => {
        try {
            const res = await apiPost('/api/leads/ocr/save', body);
            if (res.ok) {
                showToast('Lead saved successfully!', 'success');
                setTimeout(() => window.location.href = '/leads', 1500);
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to save lead', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}
