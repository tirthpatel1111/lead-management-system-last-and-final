/**
 * admin.js — Admin panel logic.
 * Handles user management and settings (SMTP, Interakt).
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Check if user is admin
    const user = getUser();
    if (!user || user.role !== 'admin') {
        showToast('Access denied. Admin only.', 'error');
        setTimeout(() => window.location.href = '/dashboard', 1500);
        return;
    }

    await loadUsers();
    await loadGmailSettings();
    await loadCCEmails();
    await loadIMAPSettings();
    await loadInteraktSettings();
    await loadWhatsAppTemplates();
    await loadEmailTemplates();
    await loadGoogleCalendarSettings();
    await loadOfficeHours();
    await loadThankYouTemplates();
    setupAdminActions();
});

// ──────────────────────────────────────────────
//  User Management
// ──────────────────────────────────────────────
async function loadUsers() {
    try {
        const res = await apiGet('/api/auth/users');
        if (!res || !res.ok) return;
        const users = await res.json();
        const currentUser = getUser();

        // Count how many admin accounts exist in the system
        const totalAdmins = users.filter(u => u.role === 'admin').length;
        const isLastAdmin = totalAdmins === 1;

        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = users.map(u => {
            const isSelf = currentUser && u.id === currentUser.id;
            const isSelfAndLastAdmin = isLastAdmin && isSelf && u.role === 'admin';

            // Build the delete button
            let deleteBtn;
            if (isSelfAndLastAdmin) {
                // Disabled — last admin cannot self-delete
                // No onclick — fully blocked (keyboard + mouse)
                deleteBtn = `
                    <button
                        class="btn btn-sm"
                        disabled
                        title="You are the last admin. Create another admin account first before deleting this one."
                        style="opacity:0.35;cursor:not-allowed;background:linear-gradient(135deg,#EF4444,#DC2626);color:white;pointer-events:none;"
                    >🗑️</button>`;
            } else {
                deleteBtn = `
                    <button
                        class="btn btn-sm btn-danger"
                        onclick="deleteUser(${u.id}, this)"
                        title="Delete User &amp; all their data"
                    >🗑️</button>`;
            }

            // Build the edit email button
            const editBtn = `
                <button
                    class="btn btn-sm"
                    onclick="editUserEmail(${u.id})"
                    title="Edit Email"
                    style="padding:5px 8px;background:#EFF6FF;border:1px solid #BFDBFE;color:#2563EB;border-radius:6px;cursor:pointer;font-size:0.75rem;"
                >✏️</button>`;

            return `
            <tr id="userRow-${u.id}">
                <td>${u.id}</td>
                <td><strong>${u.user_id}</strong>${isSelf ? ' <span style="font-size:0.7rem;color:#6B7280;">(you)</span>' : ''}</td>
                <td>${u.full_name}</td>
                <td>${u.role === 'admin' ? '<span class="badge badge-danger">Admin</span>' : '<span class="badge badge-info">Salesperson</span>'}</td>
                <td id="emailCell-${u.id}">${u.email || '-'}</td>
                <td>${u.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
                <td>${formatDate(u.created_at)}</td>
                <td><div style="display:flex;gap:6px;">${editBtn}${deleteBtn}</div></td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('Failed to load users:', err);
    }
}

// Inline email editing
window.editUserEmail = function(userId) {
    const cell = document.getElementById(`emailCell-${userId}`);
    if (!cell) return;
    const currentEmail = cell.textContent.trim() === '-' ? '' : cell.textContent.trim();
    cell.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;">
            <input
                type="email"
                id="emailInput-${userId}"
                value="${currentEmail}"
                placeholder="user@email.com"
                style="width:160px;padding:4px 8px;font-size:0.8125rem;border:1.5px solid #BFDBFE;border-radius:6px;outline:none;font-family:inherit;background:#F9FAFB;"
                onkeydown="if(event.key==='Enter'){saveUserEmail(${userId})}else if(event.key==='Escape'){cancelEditEmail(${userId},'${currentEmail.replace(/'/g, "\\'")}')}">
            <button onclick="saveUserEmail(${userId})" title="Save"
                style="padding:3px 6px;background:#059669;color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.75rem;line-height:1;">✓</button>
            <button onclick="cancelEditEmail(${userId},'${currentEmail.replace(/'/g, "\\'")}')" title="Cancel"
                style="padding:3px 6px;background:#9CA3AF;color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.75rem;line-height:1;">✕</button>
        </div>`;
    const inp = document.getElementById(`emailInput-${userId}`);
    if (inp) { inp.focus(); inp.select(); }
};

window.saveUserEmail = async function(userId) {
    const inp = document.getElementById(`emailInput-${userId}`);
    if (!inp) return;
    const email = inp.value.trim();
    if (!email) { showToast('Email cannot be empty', 'error'); return; }

    if (!isValidEmail(email)) { showToast('Please enter a valid email address', 'error'); return; }

    inp.disabled = true;
    try {
        const res = await apiPut(`/api/auth/users/${userId}/email`, { email });
        if (res && res.ok) {
            showToast('Email updated successfully!', 'success');
            await loadUsers();
        } else {
            const err = await res.json();
            showToast(err.detail || 'Failed to update email', 'error');
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
};

window.cancelEditEmail = function(userId, originalEmail) {
    const cell = document.getElementById(`emailCell-${userId}`);
    if (cell) cell.textContent = originalEmail || '-';
};

async function deleteUser(userId, btn) {
    // Double-check: if this is an admin account and the last one, block here too
    try {
        const usersRes = await apiGet('/api/auth/users');
        if (usersRes && usersRes.ok) {
            const allUsers = await usersRes.json();
            const currentUser = getUser();
            const targetUser = allUsers.find(u => u.id === userId);
            const totalAdmins = allUsers.filter(u => u.role === 'admin').length;
            if (targetUser && targetUser.role === 'admin' && totalAdmins <= 1 && currentUser && currentUser.id === userId) {
                showToast('You are the last admin. Create another admin account first before deleting this one.', 'error');
                return;
            }
        }
    } catch (_) { /* proceed to server-side check */ }

    if (!confirm(
        'Are you sure you want to delete this user?\n\n' +
        '⚠️ This will permanently delete:\n' +
        '  • Their account\n' +
        '  • All their leads\n' +
        '  • All their campaigns\n' +
        '  • All their scheduled meetings\n\n' +
        'This action cannot be undone.'
    )) return;

    withLoadingState(btn, '🗑️...', async () => {
        try {
            const res = await apiDelete(`/api/auth/users/${userId}`);
            if (res.ok) {
                showToast('User and all their data deleted successfully', 'success');
                // If user deleted their own account, log out
                const currentUser = getUser();
                if (currentUser && currentUser.id === userId) {
                    clearAuth();
                    window.location.href = '/';
                    return;
                }
                await loadUsers();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to delete user', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}


function setupAdminActions() {
    // Add user
    document.getElementById('btnAddUser').addEventListener('click', () => {
        const html = `
            <div class="form-group">
                <label for="newUserId">Username</label>
                <input type="text" id="newUserId" class="form-input" style="padding-left:14px;" placeholder="e.g., john">
            </div>
            <div class="form-group">
                <label for="newPassword">Password</label>
                <input type="password" id="newPassword" class="form-input" style="padding-left:14px;" placeholder="Strong password">
            </div>
            <div class="form-group">
                <label for="newFullName">Full Name</label>
                <input type="text" id="newFullName" class="form-input" style="padding-left:14px;" placeholder="John Doe">
            </div>
            <div class="form-group">
                <label for="newRole">Role</label>
                <select id="newRole" class="form-input filter-select" style="padding-left:14px;width:100%;">
                    <option value="salesperson">Salesperson</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            <div class="form-group">
                <label for="newEmail">Email <span style="color:#EF4444;">*</span></label>
                <input type="email" id="newEmail" class="form-input" style="padding-left:14px;" placeholder="john@company.com" required>
            </div>
        `;

        showModal('Add New User', html, async (close) => {
            const body = {
                user_id: document.getElementById('newUserId').value,
                password: document.getElementById('newPassword').value,
                full_name: document.getElementById('newFullName').value,
                role: document.getElementById('newRole').value,
                email: document.getElementById('newEmail').value.trim(),
            };

            if (!body.user_id || !body.password || !body.full_name || !body.email) {
                showToast('Please fill in all required fields (including email)', 'error');
                return;
            }

            if (!isValidEmail(body.email)) {
                showToast('Please enter a valid email address', 'error');
                return;
            }

            try {
                const res = await apiPost('/api/auth/users', body);
                if (res.ok) {
                    showToast('User created successfully!', 'success');
                    close();
                    await loadUsers();
                } else {
                    const err = await res.json();
                    showToast(err.detail || 'Failed to create user', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Save Gmail API
    const btnSaveGmail = document.getElementById('btnSaveGmail');
    btnSaveGmail.addEventListener('click', async () => {
        withLoadingState(btnSaveGmail, 'Saving...', async () => {
            const config = {
                client_id: document.getElementById('gmailClientId').value,
                client_secret: document.getElementById('gmailClientSecret').value,
                refresh_token: document.getElementById('gmailRefreshToken').value,
                from_email: document.getElementById('gmailFromEmail').value,
                from_name: document.getElementById('gmailFromName').value,
            };

            try {
                const res = await apiPost('/api/campaigns/settings/gmail', config);
                const data = await res.json();
                if (res.ok) {
                    showToast('Gmail API settings saved!', 'success');
                    updateGmailStatus(data.configured);
                } else {
                    showToast(data.detail || 'Failed to save', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Save IMAP -> Gmail API Fetch
    const btnSaveIMAP = document.getElementById('btnSaveIMAP');
    btnSaveIMAP.addEventListener('click', async () => {
        withLoadingState(btnSaveIMAP, 'Saving...', async () => {
            const config = {
                client_id: document.getElementById('imapClientId').value,
                client_secret: document.getElementById('imapClientSecret').value,
                refresh_token: document.getElementById('imapRefreshToken').value,
                email: document.getElementById('imapEmail').value,
            };

            try {
                const res = await apiPost('/api/campaigns/settings/imap', config);
                const data = await res.json();
                if (res.ok) {
                    showToast('Incoming Email settings saved!', 'success');
                    updateImapStatus(data.configured);
                } else {
                    showToast(data.detail || 'Failed to save', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Save Interakt
    const btnSaveInterakt = document.getElementById('btnSaveInterakt');
    btnSaveInterakt.addEventListener('click', async () => {
        withLoadingState(btnSaveInterakt, 'Saving...', async () => {
            const apiKeyVal = document.getElementById('interaktApiKey').value;
            const config = {
                language_code: document.getElementById('interaktLang').value || 'en',
            };
            // Only include api_key if not masked placeholder
            if (apiKeyVal && !apiKeyVal.endsWith('***')) {
                config.api_key = apiKeyVal;
            }

            try {
                const res = await apiPost('/api/campaigns/settings/interakt', config);
                const data = await res.json();
                if (res.ok) {
                    showToast('Interakt settings saved!', 'success');
                    updateInteraktStatus(data.configured);
                } else {
                    showToast(data.detail || 'Failed to save', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Add WhatsApp Template
    const btnAddTemplate = document.getElementById('btnAddTemplate');
    btnAddTemplate.addEventListener('click', async () => {
        withLoadingState(btnAddTemplate, 'Adding...', async () => {
            const name = document.getElementById('newTemplateName').value.trim();
            const code_name = document.getElementById('newTemplateCode').value.trim();
            
            if (!name || !code_name) {
                showToast('Both Name and Code Name are required', 'error');
                return;
            }
            
            try {
                const res = await apiPost('/api/campaigns/settings/whatsapp-templates', { name, code_name });
                if (res.ok) {
                    showToast('Template added successfully!', 'success');
                    document.getElementById('newTemplateName').value = '';
                    document.getElementById('newTemplateCode').value = '';
                    await loadWhatsAppTemplates();
                } else {
                    const data = await res.json();
                    showToast(data.detail || 'Failed to add template', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Format toggle for Email Template
    const templateFormatSelect = document.getElementById('newEmailTemplateFormat');
    if (templateFormatSelect) {
        templateFormatSelect.addEventListener('change', (e) => {
            const format = e.target.value;
            const bodyTextarea = document.getElementById('newEmailTemplateBody');
            const richTextDiv = document.getElementById('newEmailTemplateText');
            if (format === 'html') {
                bodyTextarea.style.display = 'block';
                richTextDiv.style.display = 'none';
            } else {
                bodyTextarea.style.display = 'none';
                richTextDiv.style.display = 'block';
            }
        });
    }

    // Add Email Template
    const btnAddEmailTemplate = document.getElementById('btnAddEmailTemplate');
    btnAddEmailTemplate.addEventListener('click', async () => {
        withLoadingState(btnAddEmailTemplate, 'Adding...', async () => {
            const name = document.getElementById('newEmailTemplateName').value.trim();
            const format = document.getElementById('newEmailTemplateFormat') ? document.getElementById('newEmailTemplateFormat').value : 'text';
            let html_body = '';
            
            if (format === 'html') {
                html_body = '<!--format:html-->' + document.getElementById('newEmailTemplateBody').value.trim();
            } else {
                html_body = '<!--format:text-->' + document.getElementById('newEmailTemplateText').innerHTML.trim();
            }
            
            if (!name || html_body === '<!--format:html-->' || html_body === '<!--format:text-->' || html_body === '<!--format:text--><br>') {
                showToast('Both Name and Content are required', 'error');
                return;
            }
            
            try {
                const res = await apiPost('/api/campaigns/settings/email-templates', { name, html_body, is_default: true });
                if (res.ok) {
                    showToast('Email Template added successfully!', 'success');
                    document.getElementById('newEmailTemplateName').value = '';
                    document.getElementById('newEmailTemplateBody').value = '';
                    if (document.getElementById('newEmailTemplateText')) {
                        document.getElementById('newEmailTemplateText').innerHTML = '';
                    }
                    await loadEmailTemplates();
                } else {
                    const data = await res.json();
                    showToast(data.detail || 'Failed to add template', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Save Google Calendar
    const btnSaveGCal = document.getElementById('btnSaveGCal');
    btnSaveGCal.addEventListener('click', async () => {
        withLoadingState(btnSaveGCal, 'Saving...', async () => {
            const config = {
                client_id: document.getElementById('gcalClientId').value,
                client_secret: document.getElementById('gcalClientSecret').value,
                refresh_token: document.getElementById('gcalRefreshToken').value,
                calendar_email: document.getElementById('gcalEmail').value,
            };

            if (!config.calendar_email) {
                showToast('Please enter the Admin Calendar Email', 'error');
                return;
            }

            try {
                const res = await apiPost('/api/campaigns/settings/google-calendar', config);
                const data = await res.json();
                if (res.ok) {
                    showToast('Google Calendar settings saved!', 'success');
                    updateGcalStatus(data.configured);
                } else {
                    showToast(data.detail || 'Failed to save', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Save Thank You Templates
    const btnSaveTemplates = document.getElementById('btnSaveTemplates');
    btnSaveTemplates.addEventListener('click', async () => {
        withLoadingState(btnSaveTemplates, 'Saving...', async () => {
            const posh = document.getElementById('poshTemplate').value;
            const contact_us = document.getElementById('contactUsTemplate').value;

            try {
                const res = await apiPost('/api/campaigns/settings/thank-you-templates', { posh, contact_us });
                if (res.ok) {
                    showToast('Thank You Templates saved!', 'success');
                } else {
                    const data = await res.json();
                    showToast(data.detail || 'Failed to save templates', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Delete POSH Template
    const btnDeletePoshTemplate = document.getElementById('btnDeletePoshTemplate');
    btnDeletePoshTemplate.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete the POSH template? It will be reset to default.')) return;
        withLoadingState(btnDeletePoshTemplate, 'Deleting...', async () => {
            try {
                const res = await apiDelete('/api/campaigns/settings/thank-you-templates/posh');
                if (res.ok) {
                    showToast('POSH template reset to default', 'success');
                    await loadThankYouTemplates();
                } else {
                    showToast('Failed to delete template', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Delete Contact Us Template
    const btnDeleteContactTemplate = document.getElementById('btnDeleteContactTemplate');
    btnDeleteContactTemplate.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete the Contact Us template? It will be reset to default.')) return;
        withLoadingState(btnDeleteContactTemplate, 'Deleting...', async () => {
            try {
                const res = await apiDelete('/api/campaigns/settings/thank-you-templates/contact_us');
                if (res.ok) {
                    showToast('Contact Us template reset to default', 'success');
                    await loadThankYouTemplates();
                } else {
                    showToast('Failed to delete template', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Add CC Email
    const btnAddCCEmail = document.getElementById('btnAddCCEmail');
    btnAddCCEmail.addEventListener('click', async () => {
        withLoadingState(btnAddCCEmail, 'Adding...', async () => {
            const email = document.getElementById('newCCEmail').value.trim();
            const scope_outgoing = document.getElementById('ccScopeOutgoing').checked;
            const scope_meetings = document.getElementById('ccScopeMeetings').checked;

            if (!email) {
                showToast('Please enter a CC email address', 'error');
                return;
            }

            // Basic email validation
            if (!isValidEmail(email)) {
                showToast('Please enter a valid email address', 'error');
                return;
            }

            if (!scope_outgoing && !scope_meetings) {
                showToast('Please select at least one scope (Outgoing or Meetings)', 'error');
                return;
            }

            try {
                const res = await apiPost('/api/campaigns/settings/cc-emails', { email, scope_outgoing, scope_meetings });
                if (res.ok) {
                    showToast('CC email added successfully!', 'success');
                    document.getElementById('newCCEmail').value = '';
                    document.getElementById('ccScopeOutgoing').checked = true;
                    document.getElementById('ccScopeMeetings').checked = true;
                    await loadCCEmails();
                } else {
                    const data = await res.json();
                    showToast(data.detail || 'Failed to add CC email', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Save Office Hours
    const btnSaveOfficeHours = document.getElementById('btnSaveOfficeHours');
    btnSaveOfficeHours.addEventListener('click', async () => {
        withLoadingState(btnSaveOfficeHours, 'Saving...', async () => {
            const config = {
                start_time: (document.getElementById('officeStartTime').value || '09:00').substring(0, 5),
                end_time: (document.getElementById('officeEndTime').value || '18:00').substring(0, 5),
                buffer_minutes: parseInt(document.getElementById('meetingBuffer').value) || 30,
            };

            if (!config.start_time || !config.end_time) {
                showToast('Please set both start and end times', 'error');
                return;
            }

            try {
                const res = await apiPost('/api/campaigns/settings/office-hours', config);
                const data = await res.json();
                if (res.ok) {
                    showToast('Office hours saved successfully!', 'success');
                } else {
                    showToast(data.detail || 'Failed to save office hours', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });
}

// ──────────────────────────────────────────────
//  Load Settings
// ──────────────────────────────────────────────
async function loadGmailSettings() {
    try {
        const res = await apiGet('/api/campaigns/settings/gmail');
        if (!res || !res.ok) return;
        const data = await res.json();

        document.getElementById('gmailClientId').value = data.client_id || '';
        document.getElementById('gmailClientSecret').value = data.client_secret || '';
        document.getElementById('gmailRefreshToken').value = data.refresh_token || '';
        document.getElementById('gmailFromEmail').value = data.from_email || '';
        document.getElementById('gmailFromName').value = data.from_name || 'Lead Manager';
        updateGmailStatus(data.configured);
    } catch (err) {
        console.error('Failed to load Gmail settings:', err);
    }
}

async function loadIMAPSettings() {
    try {
        const res = await apiGet('/api/campaigns/settings/imap');
        if (!res || !res.ok) return;
        const data = await res.json();

        document.getElementById('imapClientId').value = data.client_id || '';
        document.getElementById('imapClientSecret').value = data.client_secret || '';
        document.getElementById('imapRefreshToken').value = data.refresh_token || '';
        document.getElementById('imapEmail').value = data.email || '';
        updateImapStatus(data.configured);
    } catch (err) {
        console.error('Failed to load IMAP settings:', err);
    }
}

async function loadInteraktSettings() {
    try {
        const res = await apiGet('/api/campaigns/settings/interakt');
        if (!res || !res.ok) return;
        const data = await res.json();

        document.getElementById('interaktApiKey').value  = data.api_key       || '';
        document.getElementById('interaktLang').value     = data.language_code || 'en';
        updateInteraktStatus(data.configured);
    } catch (err) {
        console.error('Failed to load Interakt settings:', err);
    }
}

async function loadWhatsAppTemplates() {
    try {
        const res = await apiGet('/api/campaigns/settings/whatsapp-templates');
        if (!res || !res.ok) return;
        const templates = await res.json();
        
        const tbody = document.getElementById('templatesTableBody');
        if (templates.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:20px;color:#9CA3AF;">No templates added yet.</td></tr>';
            return;
        }
        
        tbody.innerHTML = templates.map(t => `
            <tr>
                <td><strong>${t.name}</strong></td>
                <td><code style="background:#F3F4F6;padding:2px 6px;border-radius:4px;">${t.code_name}</code></td>
                <td>${formatDate(t.created_at)}</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="deleteWhatsAppTemplate(${t.id}, this)" title="Delete Template">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load WhatsApp templates:', err);
    }
}

window.deleteWhatsAppTemplate = async function(id, btn) {
    if (!confirm('Are you sure you want to delete this template?')) return;
    withLoadingState(btn, '🗑️...', async () => {
        try {
            const res = await apiDelete(`/api/campaigns/settings/whatsapp-templates/${id}`);
            if (res.ok) {
                showToast('Template deleted', 'success');
                await loadWhatsAppTemplates();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to delete template', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

async function loadEmailTemplates() {
    try {
        const res = await apiGet('/api/campaigns/settings/email-templates');
        if (!res || !res.ok) return;
        const allTemplates = await res.json();
        // Admin panel only shows system/default templates
        const templates = allTemplates.filter(t => t.is_default);
        
        const tbody = document.getElementById('emailTemplatesTableBody');
        if (templates.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:20px;color:#9CA3AF;">No email templates added yet.</td></tr>';
            return;
        }
        
        tbody.innerHTML = templates.map(t => `
            <tr>
                <td><strong>${t.name}</strong></td>
                <td>${formatDate(t.created_at)}</td>
                <td>
                    <div style="display:flex;gap:6px;">
                        <button class="btn btn-sm" style="padding:5px 8px;background:#F5F3FF;border:1px solid #DDD6FE;color:#7C3AED;border-radius:6px;cursor:pointer;font-size:0.75rem;" onclick="previewEmailTemplate(${t.id})" title="Preview Template">👁️</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteEmailTemplate(${t.id}, this)" title="Delete Template">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load Email templates:', err);
    }
}

window.previewEmailTemplate = function(templateId) {
    // Fetch template list is already loaded; find the template
    apiGet('/api/campaigns/settings/email-templates').then(async res => {
        if (!res || !res.ok) return;
        const templates = await res.json();
        const tpl = templates.find(t => t.id === templateId);
        if (!tpl) { showToast('Template not found', 'error'); return; }

        const html = `
            <div style="margin-bottom:12px;">
                <strong style="color:#374151;">${tpl.name}</strong>
                ${tpl.subject ? `<br><span style="font-size:0.8125rem;color:#6B7280;">Subject: ${tpl.subject}</span>` : ''}
            </div>
            <div class="template-preview-container">
                <div class="template-preview-label">👁️ Email Preview</div>
                <iframe id="adminTplPreview" class="template-preview-iframe" style="display:block;height:400px;"></iframe>
            </div>
        `;
        showModal('📧 Template Preview', html);
        setTimeout(() => {
            const iframe = document.getElementById('adminTplPreview');
            if (iframe) iframe.srcdoc = tpl.html_body;
        }, 50);
    });
};

window.deleteEmailTemplate = async function(id, btn) {
    if (!confirm('Are you sure you want to delete this email template?')) return;
    withLoadingState(btn, '🗑️...', async () => {
        try {
            const res = await apiDelete(`/api/campaigns/settings/email-templates/${id}`);
            if (res.ok) {
                showToast('Email Template deleted', 'success');
                await loadEmailTemplates();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to delete template', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

async function loadGoogleCalendarSettings() {
    try {
        const res = await apiGet('/api/campaigns/settings/google-calendar');
        if (!res || !res.ok) return;
        const data = await res.json();

        document.getElementById('gcalClientId').value = data.client_id || '';
        document.getElementById('gcalClientSecret').value = data.client_secret || '';
        document.getElementById('gcalRefreshToken').value = data.refresh_token || '';
        document.getElementById('gcalEmail').value = data.calendar_email || '';
        updateGcalStatus(data.configured);
    } catch (err) {
        console.error('Failed to load Google Calendar settings:', err);
    }
}

function updateGmailStatus(configured) {
    const badge = document.getElementById('gmailStatus');
    if (configured) {
        badge.className = 'badge badge-success';
        badge.textContent = 'Configured';
    } else {
        badge.className = 'badge badge-warning';
        badge.textContent = 'Not Configured';
    }
}

function updateImapStatus(configured) {
    const badge = document.getElementById('imapStatus');
    if (!badge) return;
    if (configured) {
        badge.className = 'badge badge-success';
        badge.textContent = 'Configured';
    } else {
        badge.className = 'badge badge-warning';
        badge.textContent = 'Not Configured';
    }
}

function updateInteraktStatus(configured) {
    const badge = document.getElementById('interaktStatus');
    if (!badge) return;
    if (configured) {
        badge.className = 'badge badge-success';
        badge.textContent = 'Configured';
    } else {
        badge.className = 'badge badge-warning';
        badge.textContent = 'Not Configured';
    }
}

function updateGcalStatus(configured) {
    const badge = document.getElementById('gcalStatus');
    if (!badge) return;
    if (configured) {
        badge.className = 'badge badge-success';
        badge.textContent = 'Configured';
    } else {
        badge.className = 'badge badge-warning';
        badge.textContent = 'Not Configured';
    }
}

async function loadThankYouTemplates() {
    try {
        const res = await apiGet('/api/campaigns/settings/thank-you-templates');
        if (!res || !res.ok) return;
        const data = await res.json();
        
        document.getElementById('poshTemplate').value = data.posh || '';
        document.getElementById('contactUsTemplate').value = data.contact_us || '';
    } catch (err) {
        console.error('Failed to load Thank You templates:', err);
    }
}

// ──────────────────────────────────────────────
//  CC Emails Management
// ──────────────────────────────────────────────
async function loadCCEmails() {
    try {
        const res = await apiGet('/api/campaigns/settings/cc-emails');
        if (!res || !res.ok) return;
        const ccEmails = await res.json();

        const tbody = document.getElementById('ccEmailsTableBody');
        if (ccEmails.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding:20px;color:#9CA3AF;">No default CC emails added yet.</td></tr>';
            return;
        }

        tbody.innerHTML = ccEmails.map(cc => `
            <tr>
                <td><strong>${cc.email}</strong></td>
                <td style="text-align:center;">${cc.scope_outgoing ? '<span style="color:#059669;font-size:1.1rem;">✅</span>' : '<span style="color:#DC2626;font-size:1.1rem;">❌</span>'}</td>
                <td style="text-align:center;">${cc.scope_meetings ? '<span style="color:#059669;font-size:1.1rem;">✅</span>' : '<span style="color:#DC2626;font-size:1.1rem;">❌</span>'}</td>
                <td>${formatDate(cc.created_at)}</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="deleteCCEmail(${cc.id}, this)" title="Delete CC Email">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load CC emails:', err);
    }
}

window.deleteCCEmail = async function(id, btn) {
    if (!confirm('Are you sure you want to delete this CC email?')) return;
    withLoadingState(btn, '🗑️...', async () => {
        try {
            const res = await apiDelete(`/api/campaigns/settings/cc-emails/${id}`);
            if (res.ok) {
                showToast('CC email deleted', 'success');
                await loadCCEmails();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to delete CC email', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

// ──────────────────────────────────────────────
//  Office Hours Settings
// ──────────────────────────────────────────────
async function loadOfficeHours() {
    try {
        const res = await apiGet('/api/campaigns/settings/office-hours');
        if (!res || !res.ok) return;
        const data = await res.json();

        document.getElementById('officeStartTime').value = data.start_time || '09:00';
        document.getElementById('officeEndTime').value = data.end_time || '18:00';
        document.getElementById('meetingBuffer').value = data.buffer_minutes ?? 30;
    } catch (err) {
        console.error('Failed to load office hours:', err);
    }
}
