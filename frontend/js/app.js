/**
 * app.js — Shared utilities for all pages.
 * Includes: auth helpers, API client, sidebar setup, and common UI functions.
 */

// ──────────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────────
const API_BASE = window.location.origin;
const TOKEN_KEY = 'lms_token';
const USER_KEY = 'lms_user';

// ──────────────────────────────────────────────
//  Auth Utilities
// ──────────────────────────────────────────────
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
    const data = localStorage.getItem(USER_KEY);
    return data ? JSON.parse(data) : null;
}

function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

function requireAuth() {
    if (!getToken()) {
        window.location.href = '/';
        return false;
    }
    return true;
}

// ──────────────────────────────────────────────
//  API Client (with auto-auth headers)
// ──────────────────────────────────────────────
async function apiGet(path) {
    const response = await fetch(`${API_BASE}${path}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` },
    });
    if (response.status === 401) {
        clearAuth();
        window.location.href = '/';
        return null;
    }
    return response;
}

async function apiPost(path, body) {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (response.status === 401) {
        clearAuth();
        window.location.href = '/';
        return null;
    }
    return response;
}

async function apiPut(path, body) {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (response.status === 401) {
        clearAuth();
        window.location.href = '/';
        return null;
    }
    return response;
}

async function apiDelete(path) {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` },
    });
    if (response.status === 401) {
        clearAuth();
        window.location.href = '/';
        return null;
    }
    return response;
}

async function apiUpload(path, formData) {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` },
        body: formData,
    });
    if (response.status === 401) {
        clearAuth();
        window.location.href = '/';
        return null;
    }
    return response;
}

// ──────────────────────────────────────────────
//  Sidebar & Layout Setup
// ──────────────────────────────────────────────
function setupLayout() {
    const user = getUser();
    if (!user) return;

    // User info
    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarUserRole = document.getElementById('sidebarUserRole');
    const userAvatar = document.getElementById('userAvatar');
    const greetingName = document.getElementById('greetingName');
    const adminSection = document.getElementById('adminSection');

    if (sidebarUserName) sidebarUserName.textContent = user.full_name || user.user_id;
    if (sidebarUserRole) sidebarUserRole.textContent = user.role;
    if (greetingName) greetingName.textContent = user.full_name || user.user_id;

    if (userAvatar) {
        const initials = (user.full_name || user.user_id)
            .split(' ')
            .map(w => w[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
        userAvatar.textContent = initials;
    }

    if (adminSection && user.role === 'admin') {
        adminSection.classList.remove('hidden');
    }

    // Greeting
    const welcomeText = document.getElementById('welcomeText');
    if (welcomeText) {
        const hour = new Date().getHours();
        if (hour < 12) welcomeText.textContent = 'Good morning! ☀️';
        else if (hour < 17) welcomeText.textContent = 'Good afternoon! 👋';
        else welcomeText.textContent = 'Good evening! 🌙';
    }

    // Sidebar toggle
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuToggle = document.getElementById('menuToggle');

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('show');
            document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
            document.body.style.overflow = '';
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar) {
            sidebar.classList.remove('open');
            if (overlay) overlay.classList.remove('show');
            document.body.style.overflow = '';
        }
    });

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            clearAuth();
            window.location.href = '/';
        });
    }

    // Active nav item
    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('href') === currentPath) {
            item.classList.add('active');
        }
    });

    // ── Sidebar Lead Count Badge (all pages) ──────────────────────────────
    // Fetch lead count once on every page load and update the sidebar badge.
    const leadBadge = document.getElementById('leadCount');
    if (leadBadge) {
        apiGet('/api/dashboard/stats').then(res => {
            if (res && res.ok) {
                res.json().then(data => {
                    leadBadge.textContent = (data.leads && data.leads.total) || 0;
                }).catch(() => {});
            }
        }).catch(() => {});
    }

    // ── Self-Delete Account (Salespersons only) ────────────────────────────
    // Admins manage their own account from the Admin Panel user table.
    if (user.role === 'salesperson') {
        const sidebarFooter = document.querySelector('.sidebar-footer');
        if (sidebarFooter) {
            const deleteAccBtn = document.createElement('button');
            deleteAccBtn.id = 'btnDeleteMyAccount';
            deleteAccBtn.style.cssText = [
                'width:100%', 'margin-top:8px', 'padding:8px 12px',
                'background:transparent', 'border:1px solid #FCA5A5',
                'color:#DC2626', 'border-radius:8px', 'font-size:0.8125rem',
                'font-weight:500', 'cursor:pointer', 'display:flex',
                'align-items:center', 'justify-content:center', 'gap:6px',
                'transition:background 0.2s',
            ].join(';');
            deleteAccBtn.innerHTML = '<span>🗑️</span><span>Delete My Account</span>';
            deleteAccBtn.addEventListener('mouseenter', () => { deleteAccBtn.style.background = '#FEF2F2'; });
            deleteAccBtn.addEventListener('mouseleave', () => { deleteAccBtn.style.background = 'transparent'; });
            deleteAccBtn.addEventListener('click', () => {
                withLoadingState(deleteAccBtn, '<span>🗑️</span><span>Processing...</span>', async () => {
                    await deleteSelfAccount(user.id);
                });
            });
            sidebarFooter.appendChild(deleteAccBtn);
        }
    }
}

// ──────────────────────────────────────────────
//  Self-Delete Account (called from sidebar button)
// ──────────────────────────────────────────────
async function deleteSelfAccount(userId) {
    if (!confirm(
        'Are you sure you want to delete YOUR account?\n\n' +
        '⚠️ This will permanently delete:\n' +
        '  • Your account\n' +
        '  • All your leads\n' +
        '  • All your campaigns\n' +
        '  • All your scheduled meetings\n\n' +
        'You will be logged out immediately. This cannot be undone.'
    )) return;

    try {
        const res = await apiDelete(`/api/auth/users/${userId}`);
        if (res && res.ok) {
            showToast('Account deleted. Goodbye!', 'success');
            setTimeout(() => {
                clearAuth();
                window.location.href = '/';
            }, 1200);
        } else {
            const data = await res.json();
            showToast(data.detail || 'Failed to delete account', 'error');
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// ──────────────────────────────────────────────
//  Loading State Wrapper for Standalone Buttons
// ──────────────────────────────────────────────
async function withLoadingState(btn, loadingText, asyncFn) {
    if (!btn) return;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = loadingText || 'Processing...';
    try {
        await asyncFn();
    } finally {
        if (document.body.contains(btn)) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

// ──────────────────────────────────────────────
//  Toast / Notification
// ──────────────────────────────────────────────
function showToast(message, type = 'success') {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ──────────────────────────────────────────────
//  Modal Helper
// ──────────────────────────────────────────────
function showModal(title, contentHTML, onSave = null) {
    // Remove existing modal
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" id="modalClose">&times;</button>
            </div>
            <div class="modal-body">${contentHTML}</div>
            ${onSave ? '<div class="modal-footer"><button class="btn btn-secondary" id="modalCancel">Cancel</button><button class="btn btn-primary" id="modalSave">Save</button></div>' : ''}
        </div>
    `;
    document.body.appendChild(modal);

    setTimeout(() => modal.classList.add('show'), 10);

    // Close handlers
    const closeModal = () => {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    };

    document.getElementById('modalClose').addEventListener('click', closeModal);
    if (document.getElementById('modalCancel')) {
        document.getElementById('modalCancel').addEventListener('click', closeModal);
    }
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    if (onSave && document.getElementById('modalSave')) {
        document.getElementById('modalSave').addEventListener('click', async () => {
            const btn = document.getElementById('modalSave');
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Processing...';
            try {
                await onSave(closeModal);
            } finally {
                if (document.body.contains(btn)) {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            }
        });
    }

    return closeModal;
}

// ──────────────────────────────────────────────
//  Format Date Utility
// ──────────────────────────────────────────────
function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

// ──────────────────────────────────────────────
//  Status Badge Utility
// ──────────────────────────────────────────────
function statusBadge(status) {
    const colors = {
        new: 'info',
        contacted: 'warning',
        won: 'success',
        approved: 'success',
        lost: 'danger',
        pending: 'warning',
        sent: 'success',
        failed: 'danger',
        website: 'info',
    };
    const labels = {
        new: 'New',
        contacted: 'Contacted',
        won: 'Approved',
        approved: 'Approved',
        lost: 'Lost',
        pending: 'Pending',
        sent: 'Sent',
        failed: 'Failed',
        email: 'Email',
        whatsapp: 'WhatsApp',
        website: 'Website',
    };
    const label = labels[status] || status;
    return `<span class="badge badge-${colors[status] || 'neutral'}">${label}</span>`;
}

// ──────────────────────────────────────────────
//  Validation Helpers (shared across all pages)
// ──────────────────────────────────────────────

/** Validate email format. Returns true if valid or empty (optional field). */
function isValidEmail(email) {
    if (!email || !email.trim()) return true;
    return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email.trim());
}

/** Validate phone format. Returns true if valid or empty (optional field).
 *  Accepted: 1234567890 (10 digits), +911234567890 (13 chars), +91 1234567890 (14 chars) */
function isValidPhone(phone) {
    if (!phone || !phone.trim()) return true;
    return /^(\d{10}|\+91\d{10}|\+91\s\d{10})$/.test(phone.trim());
}

// ──────────────────────────────────────────────
//  CC Email Helpers (shared across pages)
// ──────────────────────────────────────────────

/**
 * Build the CC Recipients section HTML for campaign/meeting modals.
 * @param {string} containerId - Unique ID for the CC container
 * @param {Array} adminCCs - Admin default CC emails [{id, email}]
 * @param {Array} userCCs - User custom CC emails [{id, email}]
 * @returns {string} HTML
 */
function buildCCSectionHTML(containerId, adminCCs, userCCs) {
    let adminChipsHtml = '';
    if (adminCCs && adminCCs.length > 0) {
        adminChipsHtml = adminCCs.map(cc => `
            <span class="cc-chip cc-chip-admin" title="Default CC (set by admin — cannot be removed)">
                📌 ${cc.email}
            </span>
        `).join('');
    }

    let userChipsHtml = '';
    if (userCCs && userCCs.length > 0) {
        userChipsHtml = userCCs.map(cc => `
            <div class="cc-user-row" data-cc-id="${cc.id}" data-cc-email="${cc.email}">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.8125rem;">
                    <input type="checkbox" class="cc-user-checkbox" value="${cc.email}" style="width:15px;height:15px;accent-color:#6366F1;">
                    ${cc.email}
                </label>
                <button type="button" class="cc-delete-btn" data-cc-id="${cc.id}" title="Delete this CC email">✕</button>
            </div>
        `).join('');
    }

    return `
        <div id="${containerId}" class="cc-section">
            <label style="font-size:0.875rem;font-weight:600;color:#374151;margin-bottom:6px;display:block;">📬 CC Recipients</label>
            ${adminCCs && adminCCs.length > 0 ? `
            <div class="cc-admin-list" style="margin-bottom:8px;">
                <div style="font-size:0.7rem;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Default CC (Admin)</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${adminChipsHtml}
                </div>
            </div>
            ` : ''}
            ${userCCs && userCCs.length > 0 ? `
            <div class="cc-user-list" id="${containerId}_userList" style="margin-bottom:8px;">
                <div style="font-size:0.7rem;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">My CC Emails (select to include)</div>
                ${userChipsHtml}
            </div>
            ` : `<div class="cc-user-list" id="${containerId}_userList" style="margin-bottom:8px;"></div>`}
            <div style="display:flex;gap:8px;align-items:center;">
                <input type="email" id="${containerId}_newEmail" class="form-input" style="padding-left:14px;flex:1;font-size:0.8125rem;height:34px;" placeholder="Add new CC email...">
                <button type="button" id="${containerId}_addBtn" class="btn btn-sm" style="padding:6px 12px;background:#6366F1;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.75rem;white-space:nowrap;height:34px;">+ Add CC</button>
            </div>
        </div>
    `;
}

/**
 * Wire up CC section event listeners (add new CC, delete user CC).
 * @param {string} containerId - CC container ID
 * @param {Function} onListChanged - Callback when user CC list changes (for refreshing)
 */
function wireCCEvents(containerId, onListChanged) {
    setTimeout(() => {
        const addBtn = document.getElementById(`${containerId}_addBtn`);
        const emailInput = document.getElementById(`${containerId}_newEmail`);
        const container = document.getElementById(containerId);
        if (!addBtn || !emailInput) return;

        addBtn.addEventListener('click', async () => {
            const email = emailInput.value.trim().toLowerCase();
            if (!email) { showToast('Please enter a CC email', 'error'); return; }

            if (!isValidEmail(email)) { showToast('Please enter a valid email address', 'error'); return; }

            addBtn.disabled = true;
            addBtn.textContent = '...';
            try {
                const res = await apiPost('/api/campaigns/user-cc-emails', { email });
                if (res && res.ok) {
                    showToast('CC email added!', 'success');
                    emailInput.value = '';
                    if (onListChanged) await onListChanged();
                } else {
                    const err = await res.json();
                    showToast(err.detail || 'Failed to add CC email', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
            addBtn.disabled = false;
            addBtn.textContent = '+ Add CC';
        });

        // Allow Enter key to submit
        emailInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
        });

        // Delete user CC buttons
        if (container) {
            container.addEventListener('click', async (e) => {
                const deleteBtn = e.target.closest('.cc-delete-btn');
                if (!deleteBtn) return;

                const ccId = deleteBtn.dataset.ccId;
                if (!ccId) return;
                if (!confirm('Delete this CC email from your list?')) return;

                deleteBtn.disabled = true;
                try {
                    const res = await apiDelete(`/api/campaigns/user-cc-emails/${ccId}`);
                    if (res && res.ok) {
                        showToast('CC email removed', 'success');
                        if (onListChanged) await onListChanged();
                    } else {
                        const err = await res.json();
                        showToast(err.detail || 'Failed to remove CC email', 'error');
                    }
                } catch (err) {
                    showToast('Error: ' + err.message, 'error');
                }
                deleteBtn.disabled = false;
            });
        }
    }, 100);
}

/**
 * Get all selected CC emails from a CC section.
 * Returns array of email strings (admin defaults are always included).
 * @param {string} containerId - CC container ID
 * @param {Array} adminCCs - Admin default CC emails
 * @returns {Array<string>} - Selected CC email addresses
 */
function getSelectedCCEmails(containerId, adminCCs) {
    const selected = [];

    // User-selected CCs (checkbox must be checked)
    const container = document.getElementById(containerId);
    if (container) {
        container.querySelectorAll('.cc-user-checkbox:checked').forEach(cb => {
            if (cb.value) selected.push(cb.value.trim().toLowerCase());
        });
    }

    // Deduplicate (admin CCs are sent server-side, but include user-selected ones)
    return [...new Set(selected)];
}

// ──────────────────────────────────────────────
//  Init on page load
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    requireAuth();
    setupLayout();
});
