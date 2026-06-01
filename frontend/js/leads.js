/**
 * leads.js — Lead management page logic.
 * Handles: listing, adding, editing, deleting leads, Excel upload.
 */

let allLeads = [];
let allWhatsAppTemplates = [];
let allEmailTemplates = [];
let campaignCounts = {};
let currentPage = 1;
let rowsPerPage = 25;

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get('status');
    if (statusParam) {
        const filter = document.getElementById('statusFilter');
        if (filter) filter.value = statusParam;
    }

    // Attach event listeners synchronously before any await
    setupLeadActions();

    // Trigger actions immediately to preserve user gesture token for file dialogs
    const actionParam = params.get('action');
    if (actionParam === 'upload') {
        const fileInput = document.getElementById('excelFileInput');
        if (fileInput) fileInput.click();

        // Remove action param from URL to prevent re-triggering on refresh
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (actionParam === 'add') {
        setTimeout(showAddLeadModal, 100);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Fetch data asynchronously
    await loadLeads();
    await loadWhatsAppTemplates();
    await loadEmailTemplates();
});

async function loadEmailTemplates() {
    try {
        const res = await apiGet('/api/campaigns/settings/email-templates');
        if (res.ok) {
            allEmailTemplates = await res.json();
        }
    } catch (err) {
        console.error('Failed to load email templates:', err);
    }
}

// ──────────────────────────────────────────────
//  Email Template Helpers
// ──────────────────────────────────────────────

/** Build grouped <option> HTML for email template dropdown */
function buildEmailTemplateOptions() {
    const defaults = allEmailTemplates.filter(t => t.is_default);
    const personal = allEmailTemplates.filter(t => !t.is_default);
    let html = '<option value="">-- Select Email Template --</option>';
    if (defaults.length > 0) {
        html += '<optgroup label="📋 Default Templates">';
        defaults.forEach(t => { html += `<option value="${t.id}">${t.name}</option>`; });
        html += '</optgroup>';
    }
    if (personal.length > 0) {
        html += '<optgroup label="📝 My Templates">';
        personal.forEach(t => {
            const forkLabel = t.forked_from ? ' (edited)' : '';
            html += `<option value="${t.id}">${t.name}${forkLabel}</option>`;
        });
        html += '</optgroup>';
    }
    if (defaults.length === 0 && personal.length === 0) {
        html += '<option value="" disabled>No templates available</option>';
    }
    return html;
}

/** Render HTML into an iframe's srcdoc safely */
function renderPreviewIframe(iframeId, htmlContent) {
    const iframe = document.getElementById(iframeId);
    if (!iframe) return;
    if (!htmlContent) {
        iframe.style.display = 'none';
        const placeholder = iframe.parentElement.querySelector('.template-preview-placeholder');
        if (placeholder) placeholder.style.display = 'flex';
        return;
    }
    iframe.style.display = 'block';
    const placeholder = iframe.parentElement.querySelector('.template-preview-placeholder');
    if (placeholder) placeholder.style.display = 'none';
    iframe.srcdoc = htmlContent;
}

/** Get selected template object */
function getSelectedTemplate(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel || !sel.value) return null;
    return allEmailTemplates.find(t => t.id == sel.value) || null;
}

/** Check if current user can delete/edit-in-place a template */
function isOwnTemplate(template) {
    return template && !template.is_default;
}

/** Show the HTML editor modal for creating or editing a template */
function showTemplateEditorModal(existingTemplate, onSaved) {
    const isEdit = !!existingTemplate;
    const title = isEdit ? '✏️ Edit Email Template' : '➕ Create Email Template';
    const prefillName = isEdit ? existingTemplate.name : '';
    const prefillSubject = isEdit ? (existingTemplate.subject || '') : '';

    let rawHtml = isEdit ? existingTemplate.html_body : '';
    let initialFormat = 'text';
    if (rawHtml.startsWith('<!--format:html-->')) {
        initialFormat = 'html';
        rawHtml = rawHtml.substring('<!--format:html-->'.length);
    } else if (rawHtml.startsWith('<!--format:text-->')) {
        initialFormat = 'text';
        rawHtml = rawHtml.substring('<!--format:text-->'.length);
    } else if (isEdit) {
        initialFormat = 'html';
    }

    const prefillHtml = rawHtml;
    const prefillText = initialFormat === 'text' ? prefillHtml : '';
    const prefillHtmlCode = initialFormat === 'html' ? prefillHtml.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

    const editorHtml = `
        <div class="form-group">
            <label for="tplEditorName">Template Name</label>
            <input type="text" id="tplEditorName" class="form-input" style="padding-left:14px;"
                value="${prefillName.replace(/"/g, '&quot;')}" placeholder="e.g., Follow-up Email">
        </div>
        <div class="form-group">
            <label for="tplEditorSubject">Subject Line <span style="color:#9CA3AF;font-size:0.75rem;">(optional)</span></label>
            <input type="text" id="tplEditorSubject" class="form-input" style="padding-left:14px;"
                value="${prefillSubject.replace(/"/g, '&quot;')}" placeholder="e.g., Thank you for your inquiry">
        </div>
        <div style="margin-top:4px;">
            <label style="font-size:0.875rem;font-weight:600;color:#374151;margin-bottom:6px;display:block;">Email Body</label>
            <div style="margin-bottom: 8px;">
                <label style="margin-right: 8px; font-size: 0.8125rem;">Format:</label>
                <select id="tplEditorFormat" class="form-input" style="padding: 4px 8px; width: auto; display: inline-block;">
                    <option value="text" ${initialFormat === 'text' ? 'selected' : ''}>Text</option>
                    <option value="html" ${initialFormat === 'html' ? 'selected' : ''}>HTML Code</option>
                </select>
            </div>
            <div class="editor-tabs">
                <button class="editor-tab active" id="tabCode" type="button">📝 ${initialFormat === 'html' ? 'HTML Code' : 'Text Content'}</button>
                <button class="editor-tab" id="tabPreview" type="button" style="${initialFormat === 'text' ? 'display:none;' : ''}">👁️ Visual Preview</button>
            </div>
            <div id="editorCodePanel">
                <textarea id="tplEditorBody" class="html-editor-textarea" style="${initialFormat === 'html' ? 'display:block;' : 'display:none;'}"
                    placeholder="Paste or write your HTML email template here...">${prefillHtmlCode}</textarea>
                <div id="tplEditorText" class="form-input" contenteditable="true" style="${initialFormat === 'text' ? 'display:block;' : 'display:none;'} min-height: 200px; padding: 14px; background: #fff; overflow-y: auto; border: 1px solid #D1D5DB; border-radius: 6px;">${prefillText}</div>
            </div>
            <div id="editorPreviewPanel" style="display:none;">
                <iframe id="editorPreviewIframe" class="editor-preview-iframe"></iframe>
            </div>
        </div>
    `;

    // Remove existing modal first
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal modal-wide">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" id="modalClose">&times;</button>
            </div>
            <div class="modal-body">${editorHtml}</div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="modalCancel">Cancel</button>
                <button class="btn btn-primary" id="modalSave">${isEdit ? 'Save Changes' : 'Create Template'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('show'), 10);

    const closeEditor = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 300); };
    document.getElementById('modalClose').addEventListener('click', closeEditor);
    document.getElementById('modalCancel').addEventListener('click', closeEditor);
    modal.addEventListener('click', e => { if (e.target === modal) closeEditor(); });

    // Tab switching
    const tabCode = document.getElementById('tabCode');
    const tabPreview = document.getElementById('tabPreview');
    const codePanel = document.getElementById('editorCodePanel');
    const previewPanel = document.getElementById('editorPreviewPanel');

    // Format toggle
    const formatSelect = document.getElementById('tplEditorFormat');
    const bodyTextarea = document.getElementById('tplEditorBody');
    const richTextDiv = document.getElementById('tplEditorText');

    if (formatSelect) {
        formatSelect.addEventListener('change', (e) => {
            if (e.target.value === 'html') {
                bodyTextarea.style.display = 'block';
                richTextDiv.style.display = 'none';
                tabCode.textContent = '📝 HTML Code';
                tabPreview.style.display = 'inline-block';
            } else {
                bodyTextarea.style.display = 'none';
                richTextDiv.style.display = 'block';
                tabCode.textContent = '📝 Text Content';
                tabPreview.style.display = 'none';
                if (tabPreview.classList.contains('active')) {
                    tabCode.click();
                }
            }
        });
    }

    tabCode.addEventListener('click', () => {
        tabCode.classList.add('active'); tabPreview.classList.remove('active');
        codePanel.style.display = 'block'; previewPanel.style.display = 'none';
    });
    tabPreview.addEventListener('click', () => {
        tabPreview.classList.add('active'); tabCode.classList.remove('active');
        previewPanel.style.display = 'block'; codePanel.style.display = 'none';
        const iframe = document.getElementById('editorPreviewIframe');
        if (iframe) {
            const format = document.getElementById('tplEditorFormat').value;
            iframe.srcdoc = format === 'html' ? document.getElementById('tplEditorBody').value : document.getElementById('tplEditorText').innerHTML;
        }
    });

    // Save handler
    document.getElementById('modalSave').addEventListener('click', async () => {
        const saveBtn = document.getElementById('modalSave');
        const name = document.getElementById('tplEditorName').value.trim();
        const subject = document.getElementById('tplEditorSubject').value.trim();
        const format = document.getElementById('tplEditorFormat').value;
        let html_body = '';
        if (format === 'html') {
            html_body = '<!--format:html-->' + document.getElementById('tplEditorBody').value.trim();
        } else {
            html_body = '<!--format:text-->' + document.getElementById('tplEditorText').innerHTML.trim();
        }

        if (!name) { showToast('Please enter a template name', 'error'); return; }
        if (html_body === '<!--format:html-->' || html_body === '<!--format:text-->' || html_body === '<!--format:text--><br>') { showToast('Please enter the email body', 'error'); return; }

        const originalText = saveBtn.textContent;
        saveBtn.disabled = true; saveBtn.textContent = 'Saving...';

        try {
            let res;
            if (isEdit) {
                res = await apiPut(`/api/campaigns/settings/email-templates/${existingTemplate.id}`,
                    { name, subject: subject || null, html_body });
            } else {
                res = await apiPost('/api/campaigns/settings/email-templates',
                    { name, subject: subject || null, html_body });
            }
            if (res && res.ok) {
                const saved = await res.json();
                showToast(isEdit ? 'Template updated!' : 'Template created!', 'success');
                await loadEmailTemplates();
                closeEditor();
                if (onSaved) onSaved(saved);
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to save template', 'error');
                saveBtn.disabled = false; saveBtn.textContent = originalText;
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
            saveBtn.disabled = false; saveBtn.textContent = originalText;
        }
    });
}

/** Build the email template section HTML (dropdown + preview + action buttons) */
function buildEmailTemplateSectionHTML(selectId, previewId) {
    return `
        <div class="form-group">
            <label>Email Template</label>
            <select id="${selectId}" class="form-input filter-select" style="padding-left:14px;width:100%;">
                ${buildEmailTemplateOptions()}
            </select>
            <div class="template-actions-row" id="${selectId}_actions">
                <button type="button" class="template-action-btn btn-create" id="${selectId}_btnNew">➕ New</button>
                <button type="button" class="template-action-btn btn-edit" id="${selectId}_btnEdit" style="display:none;">✏️ Edit</button>
                <button type="button" class="template-action-btn btn-delete" id="${selectId}_btnDelete" style="display:none;">🗑️ Delete</button>
            </div>
        </div>
        <div class="template-preview-container" id="${previewId}_container">
            <div class="template-preview-label">👁️ Email Preview</div>
            <div class="template-preview-placeholder">
                <span class="preview-icon">📧</span>
                <span>Select a template to see preview</span>
            </div>
            <iframe id="${previewId}" class="template-preview-iframe" style="display:none;"></iframe>
        </div>
    `;
}

/** Wire up template dropdown events (preview, action buttons) */
function wireTemplateEvents(selectId, previewId, subjectInputId) {
    setTimeout(() => {
        const select = document.getElementById(selectId);
        if (!select) return;

        const btnEdit = document.getElementById(`${selectId}_btnEdit`);
        const btnDelete = document.getElementById(`${selectId}_btnDelete`);
        const btnNew = document.getElementById(`${selectId}_btnNew`);

        const refreshDropdown = (autoSelectId) => {
            select.innerHTML = buildEmailTemplateOptions();
            if (autoSelectId) select.value = autoSelectId;
            select.dispatchEvent(new Event('change'));
        };

        select.addEventListener('change', () => {
            const tpl = getSelectedTemplate(selectId);
            renderPreviewIframe(previewId, tpl ? tpl.html_body : null);
            // Auto-fill subject if template has one
            if (tpl && tpl.subject && subjectInputId) {
                const subInput = document.getElementById(subjectInputId);
                if (subInput && !subInput.value) subInput.value = tpl.subject;
            }
            // Show/hide action buttons
            if (btnEdit) btnEdit.style.display = tpl ? 'inline-flex' : 'none';
            if (btnDelete) btnDelete.style.display = (tpl && isOwnTemplate(tpl)) ? 'inline-flex' : 'none';
        });

        if (btnNew) {
            btnNew.addEventListener('click', () => {
                showTemplateEditorModal(null, (saved) => refreshDropdown(saved.id));
            });
        }

        if (btnEdit) {
            btnEdit.addEventListener('click', () => {
                const tpl = getSelectedTemplate(selectId);
                if (!tpl) { showToast('Select a template first', 'error'); return; }
                showTemplateEditorModal(tpl, (saved) => refreshDropdown(saved.id));
            });
        }

        if (btnDelete) {
            btnDelete.addEventListener('click', async () => {
                const tpl = getSelectedTemplate(selectId);
                if (!tpl) return;
                if (!confirm(`Delete template "${tpl.name}"? This cannot be undone.`)) return;
                try {
                    const res = await apiDelete(`/api/campaigns/settings/email-templates/${tpl.id}`);
                    if (res && res.ok) {
                        showToast('Template deleted', 'success');
                        await loadEmailTemplates();
                        refreshDropdown(null);
                    } else {
                        const err = await res.json();
                        showToast(err.detail || 'Cannot delete this template', 'error');
                    }
                } catch (err) { showToast('Error: ' + err.message, 'error'); }
            });
        }
    }, 80);
}

async function loadWhatsAppTemplates() {
    try {
        const res = await apiGet('/api/campaigns/settings/whatsapp-templates');
        if (res.ok) {
            allWhatsAppTemplates = await res.json();
        }
    } catch (err) {
        console.error('Failed to load templates:', err);
    }
}

// ──────────────────────────────────────────────
//  Load Leads
// ──────────────────────────────────────────────
async function loadLeads() {
    try {
        const statusFilter = document.getElementById('statusFilter').value;
        const sourceFilter = document.getElementById('sourceFilter').value;
        const search = document.getElementById('searchInput').value;

        let url = '/api/leads?';
        if (statusFilter) url += `status=${statusFilter}&`;
        if (sourceFilter) url += `source=${sourceFilter}&`;
        if (search) url += `search=${encodeURIComponent(search)}&`;

        // Fetch leads and campaign counts in parallel
        const [res, countsRes] = await Promise.all([
            apiGet(url),
            apiGet('/api/campaigns/lead-counts'),
        ]);
        if (!res || !res.ok) return;

        allLeads = await res.json();

        // Parse campaign counts
        if (countsRes && countsRes.ok) {
            campaignCounts = await countsRes.json();
        }

        // Apply client-side date filter if set
        let filteredLeads = allLeads;
        const dateFilter = document.getElementById('dateFilter');
        if (dateFilter && dateFilter.value) {
            const selectedDate = dateFilter.value; // 'YYYY-MM-DD'
            filteredLeads = allLeads.filter(lead => {
                if (!lead.created_at) return false;
                const leadDate = lead.created_at.substring(0, 10);
                return leadDate === selectedDate;
            });
        }

        renderLeadsTable(filteredLeads);

        // Update badge
        const badge = document.getElementById('leadCount');
        if (badge) badge.textContent = allLeads.length;
    } catch (err) {
        console.error('Failed to load leads:', err);
    }
}

function isLeadFilterActive() {
    const statusFilter = document.getElementById('statusFilter');
    const sourceFilter = document.getElementById('sourceFilter');
    const searchInput = document.getElementById('searchInput');
    const dateFilter = document.getElementById('dateFilter');
    return (statusFilter && statusFilter.value) ||
        (sourceFilter && sourceFilter.value) ||
        (searchInput && searchInput.value.trim()) ||
        (dateFilter && dateFilter.value);
}

function renderLeadsTable(leads) {
    const tbody = document.getElementById('leadsTableBody');
    const paginationContainer = document.getElementById('paginationContainer');
    const filterActive = isLeadFilterActive();

    if (leads.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="9" style="padding:60px;text-align:center;color:#9CA3AF;">
                <div style="font-size:2rem;margin-bottom:12px;">👥</div>
                <strong style="color:#4B5563;">No leads found</strong><br>
                <span style="font-size:0.8125rem;">Add your first lead or upload an Excel file</span>
            </td></tr>
        `;
        if (paginationContainer) paginationContainer.style.display = 'none';
        return;
    }

    // Determine which leads to show — always respect rowsPerPage setting
    let displayLeads;
    if (rowsPerPage === 'all') {
        displayLeads = leads;
        if (paginationContainer) paginationContainer.style.display = 'flex';
        // Clear page navigation since all rows are shown
        const nav = document.getElementById('paginationNav');
        if (nav) nav.innerHTML = '';
    } else {
        const totalPages = Math.ceil(leads.length / rowsPerPage);
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        const start = (currentPage - 1) * rowsPerPage;
        displayLeads = leads.slice(start, start + rowsPerPage);
        if (paginationContainer) paginationContainer.style.display = 'flex';
    }

    tbody.innerHTML = displayLeads.map(lead => {
        const emailCount = (campaignCounts[String(lead.id)] && campaignCounts[String(lead.id)].email) || 0;
        const whatsappCount = (campaignCounts[String(lead.id)] && campaignCounts[String(lead.id)].whatsapp) || 0;
        const emailBadgeClass = emailCount > 0 ? '' : 'count-badge-zero';
        const whatsappBadgeClass = whatsappCount > 0 ? '' : 'count-badge-zero';

        return `
        <tr>
            <td><input type="checkbox" class="lead-checkbox" data-id="${lead.id}"></td>
            <td><strong>${lead.company_name || '—'}</strong></td>
            <td>${lead.contact_name || '—'}</td>
            <td>${lead.email ? `<a href="mailto:${lead.email}" style="color:#2563EB;">${lead.email}</a>` : '—'}</td>
            <td>${lead.phone || '—'}</td>
            <td>${statusBadge(lead.source)}</td>
            <td>${statusBadge(lead.status)}</td>
            <td>${formatDate(lead.created_at)}</td>
            <td>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button class="btn btn-sm btn-secondary" style="padding: 6px 10px;" onclick="editLead(${lead.id})" title="Edit">✏️</button>
                    <button class="campaign-count-btn email-count-btn" ${!lead.email ? 'disabled' : `onclick="sendCampaign(${lead.id},'email')"`} title="Email campaigns sent: ${emailCount}">📧 <span class="count-badge ${emailBadgeClass}">${emailCount}</span></button>
                    <button class="campaign-count-btn whatsapp-count-btn" ${!lead.phone ? 'disabled' : `onclick="sendCampaign(${lead.id},'whatsapp')"`} title="WhatsApp campaigns sent: ${whatsappCount}">💬 <span class="count-badge ${whatsappBadgeClass}">${whatsappCount}</span></button>
                    <button class="btn btn-sm btn-danger" style="padding: 6px 10px;" onclick="deleteLead(${lead.id}, this)" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>
    `;
    }).join('');

    // Render pagination buttons
    if (rowsPerPage !== 'all') {
        renderLeadsPagination(leads.length);
    }
}

function renderLeadsPagination(totalItems) {
    const nav = document.getElementById('paginationNav');
    if (!nav) return;

    const totalPages = Math.ceil(totalItems / rowsPerPage);
    if (totalPages <= 1) {
        nav.innerHTML = '';
        return;
    }

    let html = '';

    // Previous arrow
    html += `<button class="pagination-btn nav-arrow ${currentPage === 1 ? 'disabled' : ''}" onclick="goToLeadPage(${currentPage - 1})">&lsaquo;</button>`;

    // Page numbers in fixed-width center container
    html += `<div class="pagination-pages-center">`;
    const pages = generatePageNumbers(currentPage, totalPages);
    pages.forEach(p => {
        if (p === '...') {
            html += `<span class="pagination-dots">...</span>`;
        } else {
            html += `<button class="pagination-btn ${p === currentPage ? 'active' : ''}" onclick="goToLeadPage(${p})">${p}</button>`;
        }
    });
    html += `</div>`;

    // Next arrow
    html += `<button class="pagination-btn nav-arrow ${currentPage === totalPages ? 'disabled' : ''}" onclick="goToLeadPage(${currentPage + 1})">&rsaquo;</button>`;

    nav.innerHTML = html;
}

function generatePageNumbers(current, total) {
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = [];
    // Always show first 2
    pages.push(1, 2);

    // Calculate middle range around current page
    let rangeStart = Math.max(3, current - 1);
    let rangeEnd = Math.min(total - 2, current + 1);

    // Add ellipsis before middle if needed
    if (rangeStart > 3) {
        pages.push('...');
    }

    // Add middle pages
    for (let i = rangeStart; i <= rangeEnd; i++) {
        pages.push(i);
    }

    // Add ellipsis after middle if needed
    if (rangeEnd < total - 2) {
        pages.push('...');
    }

    // Always show last 2
    if (total - 1 > 2) pages.push(total - 1);
    pages.push(total);

    // Deduplicate while preserving order (and keeping '...' markers)
    const unique = [];
    for (let i = 0; i < pages.length; i++) {
        if (pages[i] === '...' || !unique.includes(pages[i])) {
            unique.push(pages[i]);
        }
    }
    return unique;
}

function goToLeadPage(page) {
    const dateFilter = document.getElementById('dateFilter');
    let filteredLeads = allLeads;
    if (dateFilter && dateFilter.value) {
        const selectedDate = dateFilter.value;
        filteredLeads = allLeads.filter(lead => {
            if (!lead.created_at) return false;
            return lead.created_at.substring(0, 10) === selectedDate;
        });
    }
    const totalPages = Math.ceil(filteredLeads.length / rowsPerPage);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderLeadsTable(filteredLeads);
}

// ──────────────────────────────────────────────
//  Setup Actions
// ──────────────────────────────────────────────
function setupLeadActions() {
    // Search
    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', () => {
        clearTimeout(searchTimeout);
        currentPage = 1;
        searchTimeout = setTimeout(loadLeads, 400);
    });

    // Status filter
    document.getElementById('statusFilter').addEventListener('change', () => { currentPage = 1; loadLeads(); });

    // Source filter
    const sourceFilterEl = document.getElementById('sourceFilter');
    if (sourceFilterEl) sourceFilterEl.addEventListener('change', () => { currentPage = 1; loadLeads(); });

    // Date filter
    const dateFilterEl = document.getElementById('dateFilter');
    if (dateFilterEl) dateFilterEl.addEventListener('change', () => { currentPage = 1; loadLeads(); });

    // Rows per page
    const rowsPerPageEl = document.getElementById('rowsPerPage');
    if (rowsPerPageEl) {
        rowsPerPageEl.addEventListener('change', () => {
            const val = rowsPerPageEl.value;
            rowsPerPage = val === 'all' ? 'all' : parseInt(val);
            currentPage = 1;
            // Re-render with current data (no API call needed)
            const dateFilter = document.getElementById('dateFilter');
            let filteredLeads = allLeads;
            if (dateFilter && dateFilter.value) {
                const selectedDate = dateFilter.value;
                filteredLeads = allLeads.filter(lead => {
                    if (!lead.created_at) return false;
                    return lead.created_at.substring(0, 10) === selectedDate;
                });
            }
            renderLeadsTable(filteredLeads);
        });
    }

    // Dismiss selection bar (deselect all)
    const btnDismiss = document.getElementById('btnDismissSelection');
    if (btnDismiss) {
        btnDismiss.addEventListener('click', () => {
            document.querySelectorAll('.lead-checkbox').forEach(cb => cb.checked = false);
            const selAll = document.getElementById('selectAllLeads');
            if (selAll) selAll.checked = false;
            updateBulkCampaignBtn();
        });
    }

    // Add lead
    document.getElementById('btnAddLead').addEventListener('click', showAddLeadModal);

    // Sample Format Download
    const btnSampleFormat = document.getElementById('btnSampleFormat');
    if (btnSampleFormat) {
        btnSampleFormat.addEventListener('click', () => {
            window.location.href = '/api/leads/sample-format';
        });
    }

    // Download Leads as Excel
    const btnDownloadLeads = document.getElementById('btnDownloadLeads');
    if (btnDownloadLeads) {
        btnDownloadLeads.addEventListener('click', async () => {
            const statusFilter = document.getElementById('statusFilter').value;
            const sourceFilter = document.getElementById('sourceFilter').value;
            const search = document.getElementById('searchInput').value;
            const dateFilter = document.getElementById('dateFilter');
            const dateVal = dateFilter ? dateFilter.value : '';

            let url = '/api/leads/download?';
            if (statusFilter) url += `status=${encodeURIComponent(statusFilter)}&`;
            if (sourceFilter) url += `source=${encodeURIComponent(sourceFilter)}&`;
            if (search) url += `search=${encodeURIComponent(search)}&`;
            if (dateVal) url += `date=${encodeURIComponent(dateVal)}&`;

            // Apply pagination limit only when no filters are active and not showing all
            const filterActive = statusFilter || sourceFilter || search.trim() || dateVal;
            if (!filterActive && rowsPerPage !== 'all') {
                const limit = rowsPerPage;
                const offset = (currentPage - 1) * rowsPerPage;
                url += `limit=${limit}&offset=${offset}&`;
            }

            // Remove trailing & or ?
            url = url.replace(/[&?]$/, '');

            // Use fetch with auth header, then trigger blob download
            btnDownloadLeads.disabled = true;
            btnDownloadLeads.textContent = '⏳ Downloading...';
            try {
                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${getToken()}` },
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: 'Download failed' }));
                    showToast(err.detail || 'Download failed', 'error');
                    return;
                }
                const blob = await res.blob();
                const dlUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = dlUrl;
                // Extract filename from Content-Disposition header or use default
                const disposition = res.headers.get('Content-Disposition');
                const match = disposition && disposition.match(/filename="?([^"]+)"?/);
                a.download = match ? match[1] : 'leads_export.xlsx';
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(dlUrl);
                showToast('Leads downloaded successfully!', 'success');
            } catch (err) {
                showToast('Download error: ' + err.message, 'error');
            } finally {
                btnDownloadLeads.disabled = false;
                btnDownloadLeads.textContent = '📥 Download Leads';
            }
        });
    }

    // Upload Excel
    document.getElementById('btnUploadExcel').addEventListener('click', () => {
        document.getElementById('excelFileInput').click();
    });

    document.getElementById('excelFileInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        // Create full-screen processing overlay
        const overlay = document.createElement('div');
        overlay.className = 'bulk-progress-overlay';
        overlay.innerHTML = `
            <div class="bulk-progress-card">
                <div class="bulk-spinner"></div>
                <div class="bulk-progress-icon">📄</div>
                <h2 class="bulk-progress-title">Uploading Excel File</h2>
                <p class="bulk-progress-subtitle" id="excelUploadStatus">Processing your leads...</p>
                <div class="bulk-progress-bar-container">
                    <div class="bulk-progress-bar-fill indeterminate"></div>
                </div>
                <div class="bulk-progress-counter" id="excelUploadCounter">Uploading...</div>
                <p class="bulk-progress-warning">⚠️ Please do not close this page or navigate away.</p>
            </div>
        `;
        document.body.appendChild(overlay);

        try {
            const res = await apiUpload('/api/leads/upload/excel', formData);
            const data = await res.json();

            const card = overlay.querySelector('.bulk-progress-card');
            const spinner = card.querySelector('.bulk-spinner');
            if (spinner) spinner.remove();
            card.classList.add('bulk-progress-complete');

            const icon = card.querySelector('.bulk-progress-icon');
            const title = card.querySelector('.bulk-progress-title');
            const subtitle = card.querySelector('.bulk-progress-subtitle');
            const counter = card.querySelector('.bulk-progress-counter');
            const progressFill = card.querySelector('.bulk-progress-bar-fill');
            const warning = card.querySelector('.bulk-progress-warning');

            if (progressFill) {
                progressFill.classList.remove('indeterminate');
                progressFill.style.width = '100%';
            }

            if (res.ok) {
                icon.textContent = '✅';
                title.textContent = 'Upload Complete!';
                subtitle.textContent = `Successfully imported leads from Excel.`;
                counter.textContent = `${data.imported} leads imported`;
                await loadLeads();
            } else {
                icon.textContent = '❌';
                title.textContent = 'Upload Failed';
                subtitle.textContent = data.detail || 'Something went wrong during upload.';
                counter.textContent = 'Error';
            }

            // Replace warning with Close button
            if (warning) {
                warning.innerHTML = `<button class="bulk-progress-done-btn" id="excelDoneBtn">Close</button>`;
                document.getElementById('excelDoneBtn').addEventListener('click', () => overlay.remove());
            }
        } catch (err) {
            // Error state
            const card = overlay.querySelector('.bulk-progress-card');
            const spinner = card.querySelector('.bulk-spinner');
            if (spinner) spinner.remove();
            card.classList.add('bulk-progress-complete');

            card.querySelector('.bulk-progress-icon').textContent = '❌';
            card.querySelector('.bulk-progress-title').textContent = 'Upload Failed';
            card.querySelector('.bulk-progress-subtitle').textContent = err.message;
            card.querySelector('.bulk-progress-counter').textContent = 'Error';
            const progressFill = card.querySelector('.bulk-progress-bar-fill');
            if (progressFill) {
                progressFill.classList.remove('indeterminate');
                progressFill.style.width = '100%';
            }

            const warning = card.querySelector('.bulk-progress-warning');
            if (warning) {
                warning.innerHTML = `<button class="bulk-progress-done-btn" id="excelDoneBtn">Close</button>`;
                document.getElementById('excelDoneBtn').addEventListener('click', () => overlay.remove());
            }
        }

        e.target.value = ''; // Reset file input
    });

    // Delete All Leads
    const btnDeleteAllLeads = document.getElementById('btnDeleteAllLeads');
    if (btnDeleteAllLeads) {
        btnDeleteAllLeads.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to delete ALL leads? This action cannot be undone.')) return;
            withLoadingState(btnDeleteAllLeads, 'Deleting...', async () => {
                try {
                    const res = await apiDelete('/api/leads/all');
                    if (res.ok) {
                        showToast('All leads deleted successfully', 'success');
                        await loadLeads();
                    } else {
                        const err = await res.json();
                        showToast(err.detail || 'Failed to delete leads', 'error');
                    }
                } catch (err) {
                    showToast('Error: ' + err.message, 'error');
                }
            });
        });
    }

    // OCR Scan Card
    const btnScanCard = document.getElementById('btnScanCard');
    const cardFileInput = document.getElementById('cardFileInput');

    if (btnScanCard && cardFileInput) {
        btnScanCard.addEventListener('click', () => {
            cardFileInput.click();
        });

        cardFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            btnScanCard.disabled = true;

            const formData = new FormData();
            formData.append('file', file);

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
                    showOCRLeadModal(data.extracted);
                } else {
                    showToast(data.detail || 'Scan failed', 'error');
                }
            } catch (err) {
                overlay.remove();
                showToast('Scan failed: ' + err.message, 'error');
            }

            btnScanCard.disabled = false;
            e.target.value = ''; // Reset file input
        });
    }

    // Bulk Campaign setup
    const selectAll = document.getElementById('selectAllLeads');
    if (selectAll) {
        selectAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.lead-checkbox').forEach(cb => cb.checked = isChecked);
            updateBulkCampaignBtn();
        });
    }

    document.getElementById('leadsTableBody').addEventListener('change', (e) => {
        if (e.target.classList.contains('lead-checkbox')) {
            updateBulkCampaignBtn();
            const allChecked = Array.from(document.querySelectorAll('.lead-checkbox')).every(cb => cb.checked);
            const noneChecked = Array.from(document.querySelectorAll('.lead-checkbox')).every(cb => !cb.checked);
            if (selectAll) {
                selectAll.checked = allChecked;
                if (noneChecked) selectAll.checked = false;
            }
        }
    });

    const btnBulk = document.getElementById('btnBulkCampaign');
    if (btnBulk) {
        btnBulk.addEventListener('click', () => {
            const selectedIds = Array.from(document.querySelectorAll('.lead-checkbox:checked')).map(cb => parseInt(cb.dataset.id));
            if (selectedIds.length === 0) return;
            showBulkCampaignModal(selectedIds);
        });
    }

    // Delete Selected Leads (bulk — single fast request)
    const btnDeleteSelected = document.getElementById('btnDeleteSelected');
    if (btnDeleteSelected) {
        btnDeleteSelected.addEventListener('click', async () => {
            const selectedIds = Array.from(document.querySelectorAll('.lead-checkbox:checked')).map(cb => parseInt(cb.dataset.id));
            if (selectedIds.length === 0) return;

            if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected lead(s) and all their campaigns?\n\nThis action cannot be undone.`)) return;

            withLoadingState(btnDeleteSelected, '🗑️ Deleting...', async () => {
                try {
                    const res = await apiPost('/api/leads/bulk-delete', { lead_ids: selectedIds });
                    if (res && res.ok) {
                        const data = await res.json();
                        showToast(`Deleted ${data.deleted} lead(s) successfully`, 'success');
                    } else {
                        const err = await res.json();
                        showToast(err.detail || 'Failed to delete leads', 'error');
                    }
                } catch (err) {
                    showToast('Error: ' + err.message, 'error');
                }
                // Reset checkboxes
                document.querySelectorAll('.lead-checkbox').forEach(cb => cb.checked = false);
                const selAll = document.getElementById('selectAllLeads');
                if (selAll) selAll.checked = false;
                updateBulkCampaignBtn();
                await loadLeads();
            });
        });
    }
}

function updateBulkCampaignBtn() {
    const checkedCount = document.querySelectorAll('.lead-checkbox:checked').length;
    const anyChecked = checkedCount > 0;
    const btnBulk = document.getElementById('btnBulkCampaign');
    const btnDeleteSel = document.getElementById('btnDeleteSelected');
    const selectedBar = document.getElementById('selectedLeadsBar');
    const selectedText = document.getElementById('selectedLeadCount');
    if (btnBulk) {
        if (anyChecked) btnBulk.classList.remove('hidden');
        else btnBulk.classList.add('hidden');
    }
    if (btnDeleteSel) {
        if (anyChecked) btnDeleteSel.classList.remove('hidden');
        else btnDeleteSel.classList.add('hidden');
    }
    if (selectedBar) {
        if (anyChecked) selectedBar.classList.remove('hidden');
        else selectedBar.classList.add('hidden');
    }
    if (selectedText) {
        selectedText.textContent = `${checkedCount} selected`;
    }
}

// ──────────────────────────────────────────────
//  Add Lead Modal
// ──────────────────────────────────────────────
function showAddLeadModal() {
    const html = `
        <div class="form-group">
            <label for="addCompany">Company Name</label>
            <input type="text" id="addCompany" class="form-input" style="padding-left:14px;" placeholder="e.g., Acme Corp">
        </div>
        <div class="form-group">
            <label for="addContact">Contact Name</label>
            <input type="text" id="addContact" class="form-input" style="padding-left:14px;" placeholder="e.g., John Doe">
        </div>
        <div class="form-group">
            <label for="addEmail">Email <span style="color:#EF4444;">*</span></label>
            <input type="email" id="addEmail" class="form-input" style="padding-left:14px;" placeholder="e.g., john@acme.com" required>
        </div>
        <div class="form-group">
            <label for="addPhone">Phone <span style="color:#9CA3AF;font-size:0.75rem;"></span></label>
            <input type="text" id="addPhone" class="form-input" style="padding-left:14px;" placeholder="e.g., +91 98765 43210">
        </div>
        <div class="form-group">
            <label for="addNotes">Notes</label>
            <textarea id="addNotes" class="form-input" style="padding-left:14px;min-height:80px;resize:vertical;" placeholder="Any additional notes..."></textarea>
        </div>
    `;

    showModal('Add New Lead', html, async (close) => {
        const body = {
            company_name: document.getElementById('addCompany').value || null,
            contact_name: document.getElementById('addContact').value || null,
            email: document.getElementById('addEmail').value || null,
            phone: document.getElementById('addPhone').value || null,
            notes: document.getElementById('addNotes').value || null,
            source: 'manual',
        };

        // Require email
        if (!body.email) {
            showToast('Email is required to add a lead', 'error');
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

        try {
            const res = await apiPost('/api/leads', body);
            if (res.ok) {
                showToast('Lead created successfully!', 'success');
                close();
                await loadLeads();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to create lead', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

// ──────────────────────────────────────────────
//  Edit Lead Modal
// ──────────────────────────────────────────────
async function editLead(leadId) {
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    const html = `
        <div class="form-group">
            <label for="editCompany">Company Name</label>
            <input type="text" id="editCompany" class="form-input" style="padding-left:14px;" value="${lead.company_name || ''}">
        </div>
        <div class="form-group">
            <label for="editContact">Contact Name</label>
            <input type="text" id="editContact" class="form-input" style="padding-left:14px;" value="${lead.contact_name || ''}">
        </div>
        <div class="form-group">
            <label for="editEmail">Email</label>
            <input type="email" id="editEmail" class="form-input" style="padding-left:14px;" value="${lead.email || ''}">
        </div>
        <div class="form-group">
            <label for="editPhone">Phone</label>
            <input type="text" id="editPhone" class="form-input" style="padding-left:14px;" value="${lead.phone || ''}">
        </div>
        <div class="form-group">
            <label for="editStatus">Status</label>
            <select id="editStatus" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="new" ${lead.status === 'new' ? 'selected' : ''}>New</option>
                <option value="contacted" ${lead.status === 'contacted' ? 'selected' : ''}>Contacted</option>
                <option value="won" ${lead.status === 'won' ? 'selected' : ''}>Approved</option>
                <option value="lost" ${lead.status === 'lost' ? 'selected' : ''}>Lost</option>
            </select>
        </div>
        <div class="form-group">
            <label for="editNotes">Notes</label>
            <textarea id="editNotes" class="form-input" style="padding-left:14px;min-height:80px;resize:vertical;">${lead.notes || ''}</textarea>
        </div>
    `;

    showModal('Edit Lead', html, async (close) => {
        const body = {
            company_name: document.getElementById('editCompany').value || null,
            contact_name: document.getElementById('editContact').value || null,
            email: document.getElementById('editEmail').value || null,
            phone: document.getElementById('editPhone').value || null,
            status: document.getElementById('editStatus').value,
            notes: document.getElementById('editNotes').value || null,
        };

        if (body.email && !isValidEmail(body.email)) {
            showToast('Please enter a valid email (e.g., john@company.com)', 'error');
            return;
        }
        if (body.phone && !isValidPhone(body.phone)) {
            showToast('Invalid phone. Use: 1234567890, +911234567890, or +91 1234567890', 'error');
            return;
        }

        try {
            const res = await apiPut(`/api/leads/${leadId}`, body);
            if (res.ok) {
                showToast('Lead updated successfully!', 'success');
                close();
                await loadLeads();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to update lead', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

// ──────────────────────────────────────────────
//  Delete Lead
// ──────────────────────────────────────────────
async function deleteLead(leadId, btn) {
    if (!confirm('Are you sure you want to delete this lead and all its campaigns?')) return;

    withLoadingState(btn, '🗑️...', async () => {
        try {
            const res = await apiDelete(`/api/leads/${leadId}`);
            if (res.ok) {
                showToast('Lead deleted successfully', 'success');
                await loadLeads();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to delete lead', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

// ──────────────────────────────────────────────
//  Send Campaign (quick action from leads table)
// ──────────────────────────────────────────────
async function sendCampaign(leadId, type) {
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    const isEmail = type === 'email';
    const recipient = isEmail ? lead.email : lead.phone;

    // Fetch CC data for email campaigns
    let ccData = { admin_cc: [], user_cc: [] };
    if (isEmail) {
        try {
            const ccRes = await apiGet('/api/campaigns/cc-emails-for-send?scope=outgoing');
            if (ccRes && ccRes.ok) ccData = await ccRes.json();
        } catch (_) { }
    }

    const html = `
        <p style="margin-bottom:16px;color:#6B7280;">
            Sending ${isEmail ? 'email' : 'WhatsApp'} to: <strong>${recipient}</strong>
        </p>
        ${isEmail ? `
        <div class="form-group">
            <label for="campSubject">Subject <span style="color:#EF4444;">*</span></label>
            <input type="text" id="campSubject" class="form-input" style="padding-left:14px;" placeholder="Email subject" required>
        </div>
        ${buildEmailTemplateSectionHTML('campEmailTpl', 'campPreview')}
        ${buildCCSectionHTML('campCC', ccData.admin_cc, ccData.user_cc)}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding:12px 14px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;">
            <div>
                <strong style="font-size:0.875rem;color:#166534;">📅 Include Book Meeting</strong>
                <div style="font-size:0.75rem;color:#6B7280;">Append a "Book Appointment" button to the email</div>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" id="campIncludeBooking" checked>
                <span class="toggle-slider"></span>
            </label>
        </div>
        ` : `
        <div class="form-group">
            <label for="campMessage">WhatsApp Template</label>
            <select id="campMessage" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="">-- Select Template --</option>
                ${allWhatsAppTemplates.map(t => `<option value="${t.code_name}">${t.name} (${t.code_name})</option>`).join('')}
            </select>
        </div>
        `}
    `;

    showModal(`Send ${isEmail ? 'Email' : 'WhatsApp'} Campaign`, html, async (close) => {
        if (isEmail) {
            const campSubjectVal = document.getElementById('campSubject')?.value?.trim();
            if (!campSubjectVal) { showToast('Please enter an email subject', 'error'); return; }
            const tpl = getSelectedTemplate('campEmailTpl');
            if (!tpl) { showToast('Please select a template', 'error'); return; }

            const userCCs = getSelectedCCEmails('campCC', ccData.admin_cc);
            const includeBooking = document.getElementById('campIncludeBooking')?.checked ?? true;
            const body = {
                lead_id: leadId,
                campaign_type: 'email',
                subject: campSubjectVal,
                message: tpl.html_body,
                is_html: true,
                cc_emails: userCCs.length > 0 ? userCCs : null,
                include_booking: includeBooking,
            };

            try {
                const res = await apiPost('/api/campaigns/email', body);
                if (res.status === 429) {
                    const errData = await res.json();
                    showToast(errData.detail || 'Daily email limit reached.', 'error');
                    return;
                }
                const data = await res.json();
                if (res.ok && data.send_result.success) {
                    showToast('Email sent successfully!', 'success');
                    close(); await loadLeads();
                } else {
                    showToast(data.send_result?.message || data.detail || 'Campaign failed', 'error');
                }
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        } else {
            const messageVal = document.getElementById('campMessage').value;
            if (!messageVal.trim()) { showToast('Please select a template', 'error'); return; }

            const body = { lead_id: leadId, campaign_type: 'whatsapp', subject: null, message: messageVal, is_html: false };
            try {
                const res = await apiPost('/api/campaigns/whatsapp', body);
                const data = await res.json();
                if (res.ok && data.send_result.success) {
                    showToast('WhatsApp sent successfully!', 'success');
                    close(); await loadLeads();
                } else {
                    showToast(data.send_result?.message || data.detail || 'Campaign failed', 'error');
                }
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        }
    });

    // Wire up template events for email
    if (isEmail) {
        wireTemplateEvents('campEmailTpl', 'campPreview', 'campSubject');
        // Wire CC events with refresh callback
        const refreshCCSection = async () => {
            try {
                const ccRes = await apiGet('/api/campaigns/cc-emails-for-send?scope=outgoing');
                if (ccRes && ccRes.ok) {
                    ccData = await ccRes.json();
                    const container = document.getElementById('campCC');
                    if (container) {
                        container.outerHTML = buildCCSectionHTML('campCC', ccData.admin_cc, ccData.user_cc);
                        wireCCEvents('campCC', refreshCCSection);
                    }
                }
            } catch (_) { }
        };
        wireCCEvents('campCC', refreshCCSection);
    }
}


// ──────────────────────────────────────────────
//  Bulk Campaign 
// ──────────────────────────────────────────────
async function showBulkCampaignModal(selectedIds) {
    // Fetch CC data for email campaigns
    let bulkCCData = { admin_cc: [], user_cc: [] };
    try {
        const ccRes = await apiGet('/api/campaigns/cc-emails-for-send?scope=outgoing');
        if (ccRes && ccRes.ok) bulkCCData = await ccRes.json();
    } catch (_) { }

    const html = `
        <p style="margin-bottom:16px;color:#6B7280;">
            Sending campaign to: <strong>${selectedIds.length}</strong> selected leads.
        </p>
        <div class="form-group">
            <label for="bulkCampType">Campaign Type</label>
            <select id="bulkCampType" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
            </select>
        </div>
        <div class="form-group" id="bulkSubjectGroup">
            <label for="bulkCampSubject">Subject <span style="color:#EF4444;">*</span></label>
            <input type="text" id="bulkCampSubject" class="form-input" style="padding-left:14px;" placeholder="Email subject" required>
        </div>
        <div id="bulkEmailTemplateContainer">
            ${buildEmailTemplateSectionHTML('bulkCampEmailTpl', 'bulkPreview')}
        </div>
        <div id="bulkCCContainer">
            ${buildCCSectionHTML('bulkCC', bulkCCData.admin_cc, bulkCCData.user_cc)}
        </div>
        <div id="bulkBookingToggleContainer" style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding:12px 14px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;">
            <div>
                <strong style="font-size:0.875rem;color:#166534;">📅 Include Book Meeting</strong>
                <div style="font-size:0.75rem;color:#6B7280;">Append a "Book Appointment" button to each email</div>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" id="bulkIncludeBooking" checked>
                <span class="toggle-slider"></span>
            </label>
        </div>
        <div id="bulkTemplateContainer" class="form-group hidden">
            <label for="bulkCampTemplate">WhatsApp Template</label>
            <select id="bulkCampTemplate" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="">-- Select Template --</option>
                ${allWhatsAppTemplates.map(t => `<option value="${t.code_name}">${t.name} (${t.code_name})</option>`).join('')}
            </select>
        </div>
    `;

    showModal('Run Bulk Campaign', html, async (close) => {
        const type = document.getElementById('bulkCampType').value;
        const isWA = type === 'whatsapp';
        const subject = document.getElementById('bulkCampSubject').value;

        let finalMessage, isHtml = false;
        let bulkUserCCs = [];

        if (isWA) {
            const templateCode = document.getElementById('bulkCampTemplate').value;
            if (!templateCode.trim()) { showToast('Please select a template', 'error'); return; }
            finalMessage = templateCode;
        } else {
            if (!subject.trim()) { showToast('Please enter an email subject', 'error'); return; }
            const tpl = getSelectedTemplate('bulkCampEmailTpl');
            if (!tpl) { showToast('Please select an email template', 'error'); return; }
            finalMessage = tpl.html_body;
            isHtml = true;
            bulkUserCCs = getSelectedCCEmails('bulkCC', bulkCCData.admin_cc);

            // Pre-flight quota check for email campaigns
            try {
                const usageRes = await apiGet('/api/campaigns/usage');
                if (usageRes && usageRes.ok) {
                    const usage = await usageRes.json();
                    if (usage.remaining <= 0) {
                        showToast(`Daily email limit (${usage.daily_limit}) reached. Try again tomorrow.`, 'error');
                        return;
                    }
                    if (usage.remaining < selectedIds.length) {
                        showToast(`Only ${usage.remaining} emails remaining today (${usage.daily_limit}/day limit). Only the first ${usage.remaining} leads will receive emails.`, 'info');
                    }
                }
            } catch (_) { }
        }

        // Close modal and show progress overlay
        close();

        const total = selectedIds.length;
        const typeLabel = type === 'email' ? '📧 Email' : '💬 WhatsApp';

        // Create progress overlay
        const overlay = document.createElement('div');
        overlay.className = 'bulk-progress-overlay';
        overlay.innerHTML = `
            <div class="bulk-progress-card">
                <div class="bulk-spinner"></div>
                <div class="bulk-progress-icon">${type === 'email' ? '📧' : '💬'}</div>
                <h2 class="bulk-progress-title">Sending Bulk ${type === 'email' ? 'Email' : 'WhatsApp'} Campaign</h2>
                <p class="bulk-progress-subtitle">Please wait while we send to ${total} leads...</p>
                <div class="bulk-progress-bar-container">
                    <div class="bulk-progress-bar-fill" id="bulkProgressFill"></div>
                </div>
                <div class="bulk-progress-counter" id="bulkProgressCounter">0 / ${total}</div>
                <div class="bulk-progress-current" id="bulkProgressCurrent">Preparing...</div>
                <div class="bulk-progress-stats">
                    <span class="bulk-stat bulk-stat-success" id="bulkStatSuccess">✅ 0 sent</span>
                    <span class="bulk-stat bulk-stat-fail" id="bulkStatFail">❌ 0 failed</span>
                </div>
                <p class="bulk-progress-warning">⚠️ Please do not close this page or navigate away.</p>
            </div>
        `;
        document.body.appendChild(overlay);

        const progressFill = document.getElementById('bulkProgressFill');
        const progressCounter = document.getElementById('bulkProgressCounter');
        const progressCurrent = document.getElementById('bulkProgressCurrent');
        const statSuccess = document.getElementById('bulkStatSuccess');
        const statFail = document.getElementById('bulkStatFail');

        let successCount = 0, failCount = 0, quotaReached = false;

        for (let i = 0; i < selectedIds.length; i++) {
            if (quotaReached) break;
            const leadId = selectedIds[i];

            // Find lead name for display
            const leadRow = document.querySelector(`.lead-checkbox[value="${leadId}"]`);
            const leadName = leadRow ? (leadRow.closest('tr')?.querySelector('td:nth-child(3)')?.textContent?.trim() || `Lead #${leadId}`) : `Lead #${leadId}`;

            progressCurrent.textContent = `Sending to: ${leadName}...`;

            const bulkIncludeBooking = document.getElementById('bulkIncludeBooking')?.checked ?? true;
            const body = {
                lead_id: leadId,
                campaign_type: type,
                subject: type === 'email' ? (subject || 'Message from Lead Manager') : null,
                message: finalMessage,
                is_html: isHtml,
                cc_emails: (type === 'email' && bulkUserCCs.length > 0) ? bulkUserCCs : null,
                include_booking: type === 'email' ? bulkIncludeBooking : false,
            };

            try {
                const endpoint = type === 'email' ? '/api/campaigns/email' : '/api/campaigns/whatsapp';
                const res = await apiPost(endpoint, body);
                if (res.status === 429) {
                    quotaReached = true;
                    failCount++;
                    break;
                }
                if (res.ok) {
                    const data = await res.json();
                    if (data.send_result && data.send_result.success) successCount++;
                    else failCount++;
                } else { failCount++; }
            } catch (err) { failCount++; }

            // Update progress UI
            const done = i + 1;
            const pct = Math.round((done / total) * 100);
            progressFill.style.width = `${pct}%`;
            progressCounter.textContent = `${done} / ${total}`;
            statSuccess.textContent = `✅ ${successCount} sent`;
            statFail.textContent = `❌ ${failCount} failed`;
        }

        // Transition to completion state
        const card = overlay.querySelector('.bulk-progress-card');
        card.classList.add('bulk-progress-complete');
        const spinner = card.querySelector('.bulk-spinner');
        if (spinner) spinner.remove();

        const icon = card.querySelector('.bulk-progress-icon');
        const title = card.querySelector('.bulk-progress-title');
        const subtitle = card.querySelector('.bulk-progress-subtitle');
        const warning = card.querySelector('.bulk-progress-warning');

        icon.textContent = successCount > 0 ? '✅' : '⚠️';
        title.textContent = 'Bulk Campaign Complete!';
        subtitle.textContent = quotaReached
            ? `Campaign stopped — daily limit reached.`
            : `Finished sending to ${total} leads.`;

        progressFill.style.width = '100%';
        progressCounter.textContent = `${successCount + failCount} / ${total}`;
        progressCurrent.textContent = quotaReached ? 'Daily email limit reached' : 'All done!';

        // Replace warning with Close button
        if (warning) {
            warning.innerHTML = `<button class="bulk-progress-done-btn" id="bulkDoneBtn">Close</button>`;
            document.getElementById('bulkDoneBtn').addEventListener('click', () => {
                overlay.remove();
                // Reset checkboxes and refresh
                document.querySelectorAll('.lead-checkbox').forEach(cb => cb.checked = false);
                const selAll = document.getElementById('selectAllLeads');
                if (selAll) selAll.checked = false;
                updateBulkCampaignBtn();
                loadLeads();
            });
        }
    });

    // Wire up email template events
    wireTemplateEvents('bulkCampEmailTpl', 'bulkPreview', 'bulkCampSubject');

    // Wire CC events with refresh callback
    const refreshBulkCCSection = async () => {
        try {
            const ccRes = await apiGet('/api/campaigns/cc-emails-for-send?scope=outgoing');
            if (ccRes && ccRes.ok) {
                bulkCCData = await ccRes.json();
                const container = document.getElementById('bulkCC');
                if (container) {
                    container.outerHTML = buildCCSectionHTML('bulkCC', bulkCCData.admin_cc, bulkCCData.user_cc);
                    wireCCEvents('bulkCC', refreshBulkCCSection);
                }
            }
        } catch (_) { }
    };
    wireCCEvents('bulkCC', refreshBulkCCSection);

    // Toggle between email/whatsapp sections
    setTimeout(() => {
        const typeSelect = document.getElementById('bulkCampType');
        if (typeSelect) {
            typeSelect.addEventListener('change', () => {
                const isWA = typeSelect.value === 'whatsapp';
                const subjectGroup = document.getElementById('bulkSubjectGroup');
                const emailContainer = document.getElementById('bulkEmailTemplateContainer');
                const waContainer = document.getElementById('bulkTemplateContainer');
                const ccContainer = document.getElementById('bulkCCContainer');
                const bookingToggle = document.getElementById('bulkBookingToggleContainer');
                if (subjectGroup) subjectGroup.classList.toggle('hidden', isWA);
                if (emailContainer) emailContainer.classList.toggle('hidden', isWA);
                if (waContainer) waContainer.classList.toggle('hidden', !isWA);
                if (ccContainer) ccContainer.classList.toggle('hidden', isWA);
                if (bookingToggle) bookingToggle.classList.toggle('hidden', isWA);
            });
        }
    }, 100);
}


// ──────────────────────────────────────────────
//  OCR Lead Modal
// ──────────────────────────────────────────────
function showOCRLeadModal(extracted) {
    const html = `
        <div class="form-group" style="margin-bottom: 20px;">
            <div class="badge badge-info" style="display:inline-block; margin-bottom:8px;">Extracted via OCR</div>
        </div>
        <div class="form-group">
            <label for="ocrCompany">Company Name</label>
            <input type="text" id="ocrCompany" class="form-input" style="padding-left:14px;" value="${extracted.company_name || ''}">
        </div>
        <div class="form-group">
            <label for="ocrContact">Contact Name</label>
            <input type="text" id="ocrContact" class="form-input" style="padding-left:14px;" value="${extracted.contact_name || ''}">
        </div>
        <div class="form-group">
            <label for="ocrEmail">Email <span style="color:#EF4444;">*</span></label>
            <input type="email" id="ocrEmail" class="form-input" style="padding-left:14px;" value="${extracted.email || ''}" required>
        </div>
        <div class="form-group">
            <label for="ocrPhone">Phone <span style="color:#9CA3AF;font-size:0.75rem;">(optional)</span></label>
            <input type="text" id="ocrPhone" class="form-input" style="padding-left:14px;" value="${extracted.phone || ''}">
        </div>
    `;

    showModal('Review Scanned Lead', html, async (close) => {
        const body = {
            company_name: document.getElementById('ocrCompany').value || null,
            contact_name: document.getElementById('ocrContact').value || null,
            email: document.getElementById('ocrEmail').value || null,
            phone: document.getElementById('ocrPhone').value || null,
            notes: 'Extracted from visiting card via OCR',
            source: 'ocr',
        };

        // Require email
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

        try {
            const res = await apiPost('/api/leads/ocr/save', body);
            if (res.ok) {
                showToast('Lead saved successfully!', 'success');
                close();
                await loadLeads();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to save lead', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}
