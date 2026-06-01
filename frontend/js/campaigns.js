/**
 * campaigns.js — Campaign history page logic.
 * Includes: lead outcome update (Lost / Approved), Google Calendar meeting scheduling,
 * meeting details view (with copy link, edit, cancel), and HTML email template support.
 */

// Store current meeting data for edit re-use (avoids passing complex objects via onclick)
let _currentMeetingData = null;
let campCurrentPage = 1;
let campRowsPerPage = 25;

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const typeParam = params.get('type');
    if (typeParam) {
        const filter = document.getElementById('typeFilter');
        if (filter) filter.value = typeParam;
    }
    const statusParam = params.get('status');
    if (statusParam) {
        const sf = document.getElementById('statusFilter');
        if (sf) sf.value = statusParam;
    }

    await loadCampaignStats();
    await loadCampaigns();
    setupFilters();

    // Start polling every 30 seconds to detect client-booked meetings
    setInterval(async () => {
        try {
            await loadCampaigns();
        } catch (_) {}
    }, 30000);
});

async function loadCampaignStats() {
    try {
        const res = await apiGet('/api/campaigns/stats');
        if (!res || !res.ok) return;
        const stats = await res.json();

        document.getElementById('campTotal').textContent = stats.total || 0;
        document.getElementById('campSent').textContent = stats.sent || 0;
        document.getElementById('campEmail').textContent = stats.email || 0;
        document.getElementById('campWhatsApp').textContent = stats.whatsapp || 0;
        document.getElementById('campWebsite').textContent = stats.website || 0;
    } catch (err) {
        console.error('Failed to load campaign stats:', err);
    }
}

async function loadCampaigns() {
    try {
        const typeFilter = document.getElementById('typeFilter').value;
        const statusFilter = document.getElementById('statusFilter').value;
        let url = '/api/campaigns';
        const queryParts = [];
        if (typeFilter) queryParts.push(`campaign_type=${typeFilter}`);
        if (statusFilter) queryParts.push(`campaign_status=${statusFilter}`);
        if (queryParts.length) url += '?' + queryParts.join('&');

        // Fetch campaigns and meeting statuses in parallel
        const [campRes, meetRes] = await Promise.all([
            apiGet(url),
            apiGet('/api/campaigns/meeting-status'),
        ]);

        if (!campRes || !campRes.ok) return;
        const campaigns = await campRes.json();

        // Build a Set of lead_ids that have a scheduled meeting
        let meetingLeadIds = new Set();
        if (meetRes && meetRes.ok) {
            const ids = await meetRes.json();
            meetingLeadIds = new Set(ids);
        }

        const user = getUser();
        const isAdmin = user && user.role === 'admin';

        if (isAdmin) {
            document.querySelectorAll('.admin-col').forEach(el => el.style.display = 'table-cell');
        }

        const tbody = document.getElementById('campaignsTableBody');
        const colSpan = isAdmin ? 10 : 9;

        if (campaigns.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="${colSpan}" style="padding:60px;text-align:center;color:#9CA3AF;">
                    <div style="font-size:2rem;margin-bottom:12px;">📧</div>
                    <strong style="color:#4B5563;">No campaigns yet</strong><br>
                    <span style="font-size:0.8125rem;">Go to Leads page and send your first campaign</span>
                </td></tr>
            `;
            const pc = document.getElementById('paginationContainer');
            if (pc) pc.style.display = 'none';
            return;
        }

        // Client-side lead status filter
        const leadStatusFilter = document.getElementById('leadStatusFilter');
        const leadStatusVal = leadStatusFilter ? leadStatusFilter.value : '';
        let filteredCampaigns = campaigns;
        if (leadStatusVal) {
            filteredCampaigns = filteredCampaigns.filter(c => c.lead_status === leadStatusVal);
        }

        // Client-side search filter
        const searchInput = document.getElementById('campSearchInput');
        const searchVal = searchInput ? searchInput.value.trim().toLowerCase() : '';
        if (searchVal) {
            filteredCampaigns = filteredCampaigns.filter(c => {
                const fields = [
                    c.company_name || '',
                    c.contact_name || '',
                    c.lead_email || '',
                    c.lead_phone || '',
                    c.subject || '',
                    c.message || '',
                    c.sender_name || '',
                ].join(' ').toLowerCase();
                return fields.includes(searchVal);
            });
        }

        // Client-side date filter
        const dateInput = document.getElementById('campDateFilter');
        const dateVal = dateInput ? dateInput.value : '';
        if (dateVal) {
            filteredCampaigns = filteredCampaigns.filter(c => {
                if (!c.sent_at && !c.created_at) return false;
                const campDate = (c.sent_at || c.created_at || '').substring(0, 10);
                return campDate === dateVal;
            });
        }

        // Client-side email open status filter
        const emailOpenFilter = document.getElementById('emailOpenFilter');
        const emailOpenVal = emailOpenFilter ? emailOpenFilter.value : '';
        if (emailOpenVal) {
            filteredCampaigns = filteredCampaigns.filter(c => {
                if (c.campaign_type !== 'email') return false;
                if (emailOpenVal === 'opened') return c.email_opened === 1;
                if (emailOpenVal === 'sent') return c.status === 'sent' && !c.email_opened;
                return true;
            });
        }

        // Helper: strip HTML tags and decode entities for safe plain-text display
        const stripHtml = (html) => {
            if (!html) return '';
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
        };

        // Helper: build email open status dot HTML
        const emailStatusDot = (c) => {
            if (c.campaign_type !== 'email' || c.status !== 'sent') return '';
            if (c.email_opened) {
                return '<span class="email-status-dot opened" data-tooltip="Opened"></span>';
            }
            return '<span class="email-status-dot sent-only" data-tooltip="Sent"></span>';
        };

        // ── Group campaigns by lead_id, preserving order (most recent first) ──
        const grouped = {};
        const leadOrder = [];
        filteredCampaigns.forEach(c => {
            const lid = c.lead_id;
            if (!grouped[lid]) {
                grouped[lid] = [];
                leadOrder.push(lid);
            }
            grouped[lid].push(c);
        });

        // ── Determine if any filter is active ──
        const filterActive = typeFilter || statusFilter || leadStatusVal || searchVal || dateVal || emailOpenVal;
        const paginationContainer = document.getElementById('paginationContainer');

        // ── Pagination: paginate based on lead groups — always respect rowsPerPage ──
        let displayLeadOrder;
        if (campRowsPerPage === 'all') {
            displayLeadOrder = leadOrder;
            if (paginationContainer) paginationContainer.style.display = 'flex';
            // Clear page navigation since all rows are shown
            const nav = document.getElementById('paginationNav');
            if (nav) nav.innerHTML = '';
        } else {
            const totalPages = Math.ceil(leadOrder.length / campRowsPerPage);
            if (campCurrentPage > totalPages) campCurrentPage = totalPages;
            if (campCurrentPage < 1) campCurrentPage = 1;
            const start = (campCurrentPage - 1) * campRowsPerPage;
            displayLeadOrder = leadOrder.slice(start, start + campRowsPerPage);
            if (paginationContainer) paginationContainer.style.display = 'flex';
        }

        // Helper: build action cell for a campaign
        const buildActionCell = (c) => {
            const leadStatus = c.lead_status || '';
            const leadId = c.lead_id;
            const leadName = (c.company_name || c.contact_name || c.lead_email || '-').replace(/'/g, "\\'");

            let buttons = '';

            if ((c.status === 'sent' && leadStatus === 'contacted') ||
                (c.campaign_type === 'website' && (leadStatus === 'new' || leadStatus === 'contacted'))) {
                buttons += `
                    <button
                        class="btn btn-sm btn-primary"
                        style="padding:5px 10px;font-size:0.75rem;white-space:nowrap;"
                        onclick="showOutcomeModal(${leadId}, '${leadName}', '${c.lead_email || ''}')"
                        title="Update lead outcome: Lost or Approved"
                    >
                        📋 Update Outcome
                    </button>
                `;
            }

            // Show "Copy Booking Link" for contacted/new leads that don't have a meeting yet
            if ((leadStatus === 'contacted' || leadStatus === 'new' ||
                 (leadStatus === 'won' && !meetingLeadIds.has(leadId))) && c.status === 'sent') {
                buttons += `
                    <button
                        class="btn btn-sm booking-link-btn"
                        style="padding:5px 10px;font-size:0.75rem;white-space:nowrap;background:linear-gradient(135deg,#8B5CF6,#7C3AED);color:white;border:none;border-radius:6px;cursor:pointer;"
                        onclick="event.stopPropagation(); copyBookingLink(${leadId}, this)"
                        title="Copy booking link to share with client"
                    >
                        📋 Copy Booking Link
                    </button>
                `;
            }

            if (leadStatus === 'won' && meetingLeadIds.has(leadId)) {
                buttons += `
                    <button
                        class="btn btn-sm"
                        style="padding:5px 10px;font-size:0.75rem;white-space:nowrap;background:#7C3AED;color:white;border:none;border-radius:6px;cursor:pointer;"
                        onclick="showMeetingDetailsModal(${leadId}, '${leadName}')"
                        title="View scheduled meeting details"
                    >
                        👁️ View Meeting
                    </button>
                `;
            }

            if (!buttons) return '<span style="color:#9CA3AF;font-size:0.75rem;">—</span>';
            return `<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">${buttons}</div>`;
        };

        // Helper: render a single campaign row
        const renderRow = (c, opts = {}) => {
            const { isChild = false, hidden = false, adminVisible = isAdmin } = opts;
            const leadStatus = c.lead_status || '';

            const childStyle = isChild
                ? 'background:#F9FAFB;border-left:3px solid #6366F1;'
                : '';
            const displayStyle = hidden ? 'display:none;' : '';

            return `
                <tr class="${isChild ? `child-row-${c.lead_id}` : ''}" style="${childStyle}${displayStyle}">
                    <td>${isChild ? '<span style="color:#A5B4FC;padding-left:8px;">↳</span>' : `<span style="display:inline-flex;align-items:center;gap:6px;">${emailStatusDot(c)}<strong>${c.company_name || c.lead_email || '-'}</strong></span>`}</td>
                    <td>${isChild ? '' : (c.contact_name || '-')}</td>
                    ${adminVisible ? `<td>
                        ${c.sender_role === 'admin'
                        ? `<span class="badge badge-danger" title="Admin">${c.sender_name || 'Admin'}</span>`
                        : `<span class="badge badge-info" title="Salesperson">${c.sender_name || 'User'}</span>`}
                    </td>` : ''}
                    <td>${c.campaign_type === 'email' ? '<span class="badge badge-info">Email</span>' : c.campaign_type === 'website' ? '<span class="badge" style="background:#DBEAFE;color:#1D4ED8;">Website</span>' : '<span class="badge badge-success">WhatsApp</span>'}</td>
                    <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${stripHtml(c.subject)}">${stripHtml(c.subject) || '-'}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${stripHtml(c.message)}">${stripHtml(c.message) || '-'}</td>
                    <td>${statusBadge(c.status)}</td>
                    <td>${isChild ? '' : (leadStatus ? statusBadge(leadStatus) : '<span style="color:#9CA3AF;">—</span>')}</td>
                    <td>${c.sent_at ? formatDate(c.sent_at) : '-'}</td>
                    <td>${isChild ? '' : buildActionCell(c)}</td>
                </tr>
            `;
        };

        // ── Build grouped table rows ──
        let html = '';
        displayLeadOrder.forEach(leadId => {
            const group = grouped[leadId];
            const latest = group[0]; // most recent (already sorted DESC by backend)

            if (group.length === 1) {
                // Single campaign — render normally
                html += renderRow(latest);
            } else {
                // Multiple campaigns — render main row with expand toggle
                const leadStatus = latest.lead_status || '';
                const leadName = (latest.company_name || latest.contact_name || latest.lead_email || '-').replace(/'/g, "\\'");

                // Count campaign types in group
                const emailCount = group.filter(c => c.campaign_type === 'email').length;
                const waCount = group.filter(c => c.campaign_type === 'whatsapp').length;
                const webCount = group.filter(c => c.campaign_type === 'website').length;

                let btnParts = [];
                if (emailCount > 0) btnParts.push(`Email ${emailCount}`);
                if (waCount > 0) btnParts.push(`WhatsApp ${waCount}`);
                if (webCount > 0) btnParts.push(`Web ${webCount}`);
                const btnText = btnParts.length > 1 ? `${group.length} Campaigns` : btnParts[0] || `${group.length}`;

                html += `
                    <tr style="cursor:pointer;" onclick="toggleLeadCampaigns(${leadId})" title="Click to expand/collapse ${group.length} campaigns">
                        <td>
                            <span style="display:inline-flex;align-items:center;gap:6px;">${emailStatusDot(latest)}<strong>${latest.company_name || latest.lead_email || '-'}</strong></span>
                        </td>
                        <td>${latest.contact_name || '-'}</td>
                        ${isAdmin ? `<td>
                            ${latest.sender_role === 'admin'
                            ? `<span class="badge badge-danger" title="Admin">${latest.sender_name || 'Admin'}</span>`
                            : `<span class="badge badge-info" title="Salesperson">${latest.sender_name || 'User'}</span>`}
                        </td>` : ''}
                        <td>
                            <button
                                id="expandBtn-${leadId}"
                                class="btn btn-sm"
                                style="padding:4px 10px;font-size:0.7rem;white-space:nowrap;background:linear-gradient(135deg,#EEF2FF,#E0E7FF);color:#4338CA;border:1px solid #C7D2FE;border-radius:6px;cursor:pointer;font-weight:600;transition:all 0.2s;"
                                onclick="event.stopPropagation(); toggleLeadCampaigns(${leadId})"
                                title="Click to view all ${group.length} campaigns"
                            >
                                <span id="expandArrow-${leadId}">▶</span> ${btnText}
                            </button>
                        </td>
                        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${stripHtml(latest.subject)}">${stripHtml(latest.subject) || '-'}</td>
                        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${stripHtml(latest.message)}">${stripHtml(latest.message) || '-'}</td>
                        <td>${statusBadge(latest.status)}</td>
                        <td>${leadStatus ? statusBadge(leadStatus) : '<span style="color:#9CA3AF;">—</span>'}</td>
                        <td>${latest.sent_at ? formatDate(latest.sent_at) : '-'}</td>
                        <td>${buildActionCell(latest)}</td>
                    </tr>
                `;

                // Render child rows (all campaigns in this group, hidden by default)
                group.forEach(c => {
                    html += renderRow(c, { isChild: true, hidden: true });
                });
            }
        });

        tbody.innerHTML = html;

        // Render pagination buttons
        if (campRowsPerPage !== 'all') {
            renderCampaignPagination(leadOrder.length);
        }
    } catch (err) {
        console.error('Failed to load campaigns:', err);
    }
}

function renderCampaignPagination(totalGroups) {
    const nav = document.getElementById('paginationNav');
    if (!nav) return;

    const totalPages = Math.ceil(totalGroups / campRowsPerPage);
    if (totalPages <= 1) {
        nav.innerHTML = '';
        return;
    }

    let html = '';

    // Previous arrow
    html += `<button class="pagination-btn nav-arrow ${campCurrentPage === 1 ? 'disabled' : ''}" onclick="goToCampaignPage(${campCurrentPage - 1})">&lsaquo;</button>`;

    // Page numbers in fixed-width center container
    html += `<div class="pagination-pages-center">`;
    const pages = campGeneratePageNumbers(campCurrentPage, totalPages);
    pages.forEach(p => {
        if (p === '...') {
            html += `<span class="pagination-dots">...</span>`;
        } else {
            html += `<button class="pagination-btn ${p === campCurrentPage ? 'active' : ''}" onclick="goToCampaignPage(${p})">${p}</button>`;
        }
    });
    html += `</div>`;

    // Next arrow
    html += `<button class="pagination-btn nav-arrow ${campCurrentPage === totalPages ? 'disabled' : ''}" onclick="goToCampaignPage(${campCurrentPage + 1})">&rsaquo;</button>`;

    nav.innerHTML = html;
}

function campGeneratePageNumbers(current, total) {
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = [];
    pages.push(1, 2);

    let rangeStart = Math.max(3, current - 1);
    let rangeEnd = Math.min(total - 2, current + 1);

    if (rangeStart > 3) pages.push('...');
    for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
    if (rangeEnd < total - 2) pages.push('...');

    if (total - 1 > 2) pages.push(total - 1);
    pages.push(total);

    const unique = [];
    for (let i = 0; i < pages.length; i++) {
        if (pages[i] === '...' || !unique.includes(pages[i])) {
            unique.push(pages[i]);
        }
    }
    return unique;
}

function goToCampaignPage(page) {
    campCurrentPage = page;
    loadCampaigns();
}

function setupFilters() {
    document.getElementById('typeFilter').addEventListener('change', () => { campCurrentPage = 1; loadCampaigns(); });
    document.getElementById('statusFilter').addEventListener('change', () => { campCurrentPage = 1; loadCampaigns(); });

    // Lead status filter
    const leadStatusFilterEl = document.getElementById('leadStatusFilter');
    if (leadStatusFilterEl) leadStatusFilterEl.addEventListener('change', () => { campCurrentPage = 1; loadCampaigns(); });

    // Search input (debounced)
    const searchInputEl = document.getElementById('campSearchInput');
    if (searchInputEl) {
        let searchTimeout;
        searchInputEl.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => { campCurrentPage = 1; loadCampaigns(); }, 400);
        });
    }

    // Date filter
    const dateFilterEl = document.getElementById('campDateFilter');
    if (dateFilterEl) dateFilterEl.addEventListener('change', () => { campCurrentPage = 1; loadCampaigns(); });

    // Email open status filter
    const emailOpenFilterEl = document.getElementById('emailOpenFilter');
    if (emailOpenFilterEl) emailOpenFilterEl.addEventListener('change', () => { campCurrentPage = 1; loadCampaigns(); });

    // Rows per page
    const rowsPerPageEl = document.getElementById('rowsPerPage');
    if (rowsPerPageEl) {
        rowsPerPageEl.addEventListener('change', () => {
            const val = rowsPerPageEl.value;
            campRowsPerPage = val === 'all' ? 'all' : parseInt(val);
            campCurrentPage = 1;
            loadCampaigns();
        });
    }

    // Download Campaigns as Excel
    const btnDownloadCampaignLeads = document.getElementById('btnDownloadCampaignLeads');
    if (btnDownloadCampaignLeads) {
        btnDownloadCampaignLeads.addEventListener('click', async () => {
            const typeFilter = document.getElementById('typeFilter').value;
            const statusFilter = document.getElementById('statusFilter').value;
            const leadStatusFilter = document.getElementById('leadStatusFilter');
            const leadStatusVal = leadStatusFilter ? leadStatusFilter.value : '';
            const searchInput = document.getElementById('campSearchInput');
            const searchVal = searchInput ? searchInput.value : '';
            const dateFilter = document.getElementById('campDateFilter');
            const dateVal = dateFilter ? dateFilter.value : '';
            const emailOpenFilter = document.getElementById('emailOpenFilter');
            const emailOpenVal = emailOpenFilter ? emailOpenFilter.value : '';

            let url = '/api/campaigns/download?';
            if (typeFilter) url += `campaign_type=${encodeURIComponent(typeFilter)}&`;
            if (statusFilter) url += `campaign_status=${encodeURIComponent(statusFilter)}&`;
            if (leadStatusVal) url += `lead_status=${encodeURIComponent(leadStatusVal)}&`;
            if (searchVal) url += `search=${encodeURIComponent(searchVal)}&`;
            if (dateVal) url += `date=${encodeURIComponent(dateVal)}&`;
            if (emailOpenVal) url += `email_open=${encodeURIComponent(emailOpenVal)}&`;

            // Apply pagination limit only when no filters are active and not showing all
            const filterActive = typeFilter || statusFilter || leadStatusVal || searchVal.trim() || dateVal || emailOpenVal;
            if (!filterActive && campRowsPerPage !== 'all') {
                const limit = campRowsPerPage;
                const offset = (campCurrentPage - 1) * campRowsPerPage;
                url += `limit=${limit}&offset=${offset}&`;
            }

            // Remove trailing & or ?
            url = url.replace(/[&?]$/, '');

            // Use fetch with auth header, then trigger blob download
            btnDownloadCampaignLeads.disabled = true;
            btnDownloadCampaignLeads.textContent = '⏳ Downloading...';
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
                a.download = match ? match[1] : 'campaigns_export.xlsx';
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(dlUrl);
                showToast('Campaigns downloaded successfully!', 'success');
            } catch (err) {
                showToast('Download error: ' + err.message, 'error');
            } finally {
                btnDownloadCampaignLeads.disabled = false;
                btnDownloadCampaignLeads.textContent = '📥 Download Leads';
            }
        });
    }
}

function setCampaignFilter(type) {
    const filter = document.getElementById('typeFilter');
    const sf = document.getElementById('statusFilter');
    const lsf = document.getElementById('leadStatusFilter');
    const si = document.getElementById('campSearchInput');
    const df = document.getElementById('campDateFilter');
    if (filter) {
        filter.value = type;
        if (sf) sf.value = '';
        if (lsf) lsf.value = '';
        if (si) si.value = '';
        if (df) df.value = '';
        campCurrentPage = 1;
        loadCampaigns();
    }
}

function setCampaignStatusFilter(status) {
    const sf = document.getElementById('statusFilter');
    const tf = document.getElementById('typeFilter');
    const lsf = document.getElementById('leadStatusFilter');
    const si = document.getElementById('campSearchInput');
    const df = document.getElementById('campDateFilter');
    if (sf) {
        sf.value = status;
        if (tf) tf.value = '';
        if (lsf) lsf.value = '';
        if (si) si.value = '';
        if (df) df.value = '';
        campCurrentPage = 1;
        loadCampaigns();
    }
}

// ──────────────────────────────────────────────
//  Toggle expand/collapse for grouped lead campaigns
// ──────────────────────────────────────────────
function toggleLeadCampaigns(leadId) {
    const childRows = document.querySelectorAll(`.child-row-${leadId}`);
    const arrow = document.getElementById(`expandArrow-${leadId}`);
    const btn = document.getElementById(`expandBtn-${leadId}`);

    if (!childRows.length) return;

    const isExpanded = childRows[0].style.display !== 'none';

    childRows.forEach(row => {
        row.style.display = isExpanded ? 'none' : '';
    });

    if (arrow) {
        arrow.textContent = isExpanded ? '▶' : '▼';
    }
    if (btn) {
        btn.style.background = isExpanded
            ? 'linear-gradient(135deg,#EEF2FF,#E0E7FF)'
            : 'linear-gradient(135deg,#E0E7FF,#C7D2FE)';
    }
}

// ──────────────────────────────────────────────
//  Outcome Modal — Lost or Approved
// ──────────────────────────────────────────────
function showOutcomeModal(leadId, leadName, leadEmail) {
    const html = `
        <p style="margin-bottom:20px;color:#6B7280;">
            Update outcome for lead: <strong>${leadName}</strong>
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:8px;">
            <button
                id="btnLost"
                class="btn"
                style="padding:18px;border:2px solid #FCA5A5;background:#FEF2F2;color:#DC2626;border-radius:12px;font-size:1rem;font-weight:600;cursor:pointer;transition:all 0.2s;"
                onclick="confirmOutcome(${leadId}, 'lost', null, null, this)"
            >
                ❌ Lost<br>
                <span style="font-size:0.75rem;font-weight:400;opacity:0.8;">Lead did not convert</span>
            </button>
            <button
                id="btnApproved"
                class="btn"
                style="padding:18px;border:2px solid #6EE7B7;background:#ECFDF5;color:#059669;border-radius:12px;font-size:1rem;font-weight:600;cursor:pointer;transition:all 0.2s;"
                onclick="confirmOutcome(${leadId}, 'won', '${leadName.replace(/'/g, "\\'")}', '${leadEmail || ''}', this)"
            >
                ✅ Approved<br>
                <span style="font-size:0.75rem;font-weight:400;opacity:0.8;">Schedule a meeting</span>
            </button>
        </div>
        <p style="font-size:0.75rem;color:#9CA3AF;margin-top:12px;">
            ⚠️ This action cannot be undone once saved.
        </p>
    `;

    showModal('Update Lead Outcome', html);
}

// ──────────────────────────────────────────────
//  Confirm Outcome (Lost or Won/Approved)
// ──────────────────────────────────────────────
async function confirmOutcome(leadId, outcome, leadName, leadEmail, btn) {
    const existing = document.querySelector('.modal-overlay');

    withLoadingState(btn, 'Processing...', async () => {
        if (existing) existing.remove();

        if (outcome === 'lost') {
            try {
                const res = await apiPut(`/api/campaigns/lead/${leadId}/outcome`, { outcome: 'lost' });
                if (res && res.ok) {
                    showToast('Lead marked as Lost.', 'success');
                    await loadCampaigns();
                    await loadCampaignStats();
                } else {
                    const err = await res.json();
                    showToast(err.detail || 'Failed to update outcome', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        } else if (outcome === 'won') {
            // Open scheduler directly
            showMeetingSchedulerModal(leadId, leadName, leadEmail, false);
        }
    });
}

// ──────────────────────────────────────────────
//  Meeting Scheduler Modal (create + edit)
// ──────────────────────────────────────────────
async function showMeetingSchedulerModal(leadId, leadName, leadEmail, existingMeeting = null) {
    const isEdit = !!existingMeeting;

    // Fetch CC data and office hours in parallel
    let meetCCData = { admin_cc: [], user_cc: [] };
    let officeHours = { start_time: '09:00', end_time: '18:00' };
    try {
        const [ccRes, ohRes] = await Promise.all([
            apiGet('/api/campaigns/cc-emails-for-send?scope=meetings'),
            apiGet('/api/campaigns/meeting-config'),
        ]);
        if (ccRes && ccRes.ok) meetCCData = await ccRes.json();
        if (ohRes && ohRes.ok) officeHours = await ohRes.json();
    } catch (_) {}

    // Prefill fields: use existing meeting data when editing
    let defaultDate, defaultTime, defaultTitle, defaultDesc, defaultDuration, defaultAttendee;

    if (isEdit) {
        const startDt = new Date(existingMeeting.start_datetime);
        defaultDate = startDt.toISOString().slice(0, 10);
        defaultTime = startDt.toTimeString().slice(0, 5);
        defaultTitle = existingMeeting.title;
        defaultDesc = existingMeeting.description || '';
        defaultDuration = existingMeeting.duration_minutes || 60;
        defaultAttendee = existingMeeting.attendee_email || leadEmail;
    } else {
        const now = new Date();
        now.setMinutes(now.getMinutes() + 60 - (now.getMinutes() % 30));
        defaultDate = now.toISOString().slice(0, 10);
        defaultTime = now.toTimeString().slice(0, 5);
        defaultTitle = `Meeting with ${leadName}`;
        defaultDesc = `Follow-up meeting with ${leadName} regarding their requirements.`;
        defaultDuration = 60;
        defaultAttendee = leadEmail;
    }

    const html = `
        <div style="background:linear-gradient(135deg,#EFF6FF,#F0FDF4);border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid #DBEAFE;">
            <div style="font-size:1.5rem;text-align:center;margin-bottom:8px;">📅</div>
            <p style="text-align:center;color:#1D4ED8;font-weight:600;margin:0;">${isEdit ? 'Edit Google Meet' : 'Schedule Google Meet'}</p>
            <p style="text-align:center;color:#6B7280;font-size:0.8125rem;margin:4px 0 0;">
                Meeting will be added to admin's Google Calendar
            </p>
        </div>

        <div class="form-group">
            <label for="meetTitle">Meeting Title</label>
            <input type="text" id="meetTitle" class="form-input" style="padding-left:14px;"
                value="${defaultTitle}" placeholder="Meeting title">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="form-group">
                <label for="meetDate">Date</label>
                <input type="date" id="meetDate" class="form-input" style="padding-left:14px;"
                    value="${defaultDate}" min="${new Date().toISOString().slice(0, 10)}">
            </div>
            <div class="form-group">
                <label for="meetTime">Time</label>
                <input type="time" id="meetTime" class="form-input" style="padding-left:14px;"
                    value="${defaultTime}" min="${officeHours.start_time}" max="${officeHours.end_time}">
                <div style="font-size:0.7rem;color:#6B7280;margin-top:4px;">
                    🕐 Office Hours: ${officeHours.start_time} – ${officeHours.end_time} IST
                </div>
            </div>
        </div>
        <div class="form-group">
            <label for="meetDuration">Duration (minutes)</label>
            <select id="meetDuration" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="30" ${defaultDuration == 30 ? 'selected' : ''}>30 minutes</option>
                <option value="60" ${defaultDuration == 60 ? 'selected' : ''}>60 minutes</option>
                <option value="90" ${defaultDuration == 90 ? 'selected' : ''}>90 minutes</option>
                <option value="120" ${defaultDuration == 120 ? 'selected' : ''}>2 hours</option>
            </select>
        </div>
        <div class="form-group">
            <label for="meetDescription">Description / Notes</label>
            <textarea id="meetDescription" class="form-input" style="padding-left:14px;min-height:70px;resize:vertical;"
                placeholder="Any notes for the meeting...">${defaultDesc}</textarea>
        </div>
        <div class="form-group">
            <label for="meetAttendee">Lead Email (Attendee)</label>
            <input type="email" id="meetAttendee" class="form-input" style="padding-left:14px;"
                value="${defaultAttendee}" placeholder="client@example.com">
        </div>
        ${buildCCSectionHTML('meetCC', meetCCData.admin_cc, meetCCData.user_cc)}

        <div id="meetResultBox" style="display:none;margin-top:16px;padding:16px;border-radius:10px;background:#ECFDF5;border:1px solid #6EE7B7;">
            <p style="color:#059669;font-weight:600;margin:0 0 8px;">✅ Meeting ${isEdit ? 'Updated' : 'Scheduled'}!</p>
            <p id="meetLinkText" style="margin:0;font-size:0.8125rem;color:#047857;word-break:break-all;"></p>
        </div>
    `;

    showModal(isEdit ? '✏️ Edit Meeting' : '📅 Schedule Meeting', html, async (close) => {
        const saveBtn = document.getElementById('modalSave');
        const title = document.getElementById('meetTitle').value.trim();
        const date = document.getElementById('meetDate').value;
        const time = document.getElementById('meetTime').value;
        const duration = parseInt(document.getElementById('meetDuration').value);
        const description = document.getElementById('meetDescription').value.trim();
        const attendee = document.getElementById('meetAttendee').value.trim();

        if (!title) { showToast('Please enter a meeting title', 'error'); return; }
        if (!date || !time) { showToast('Please select date and time', 'error'); return; }

        const startDatetime = `${date}T${time}:00`;
        const meetUserCCs = getSelectedCCEmails('meetCC', meetCCData.admin_cc);
        const body = {
            lead_id: leadId,
            title,
            description,
            start_datetime: startDatetime,
            duration_minutes: duration,
            attendee_email: attendee || null,
            cc_emails: meetUserCCs.length > 0 ? meetUserCCs : null,
        };

        try {
            const res = await apiPost('/api/campaigns/schedule-meeting', body);
            let data;
            try {
                data = await res.json();
            } catch (parseErr) {
                // Server returned non-JSON (e.g., plain-text 500)
                showToast(`Server error (${res.status}): ${res.statusText}`, 'error');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Update Meeting' : 'Schedule Meeting'; }
                return;
            }

            if (res.ok) {
                // On first schedule: update lead status to won
                if (!isEdit) {
                    try { await apiPut(`/api/campaigns/lead/${leadId}/outcome`, { outcome: 'won' }); } catch (_) { }
                }

                const resultBox = document.getElementById('meetResultBox');
                const linkText = document.getElementById('meetLinkText');
                if (resultBox && linkText) {
                    linkText.innerHTML = data.meet_link
                        ? `🔗 Google Meet: <a href="${data.meet_link}" target="_blank" style="color:#059669;">${data.meet_link}</a><br>
                           📅 <a href="${data.event_link}" target="_blank" style="color:#047857;">View in Calendar</a>`
                        : `📅 <a href="${data.event_link}" target="_blank" style="color:#047857;">View event in Calendar</a>`;
                    resultBox.style.display = 'block';
                }

                showToast(isEdit ? 'Meeting updated successfully!' : 'Meeting scheduled! Lead marked as Approved.', 'success');
                await loadCampaigns();
                await loadCampaignStats();

                // Replace Save button with "👁️ View Meeting" button
                if (saveBtn) {
                    saveBtn.textContent = '👁️ View Meeting';
                    saveBtn.style.background = '#7C3AED';
                    saveBtn.disabled = false;
                    // Swap click handler: clone removes old listeners
                    const newBtn = saveBtn.cloneNode(true);
                    saveBtn.parentNode.replaceChild(newBtn, saveBtn);
                    newBtn.addEventListener('click', () => {
                        const overlay = document.querySelector('.modal-overlay');
                        if (overlay) {
                            overlay.classList.remove('show');
                            setTimeout(() => {
                                overlay.remove();
                                showMeetingDetailsModal(leadId, leadName);
                            }, 250);
                        }
                    });
                }
                // Change Cancel → Close
                const cancelBtn = document.getElementById('modalCancel');
                if (cancelBtn) cancelBtn.textContent = 'Close';

            } else {
                showToast(data.detail || 'Failed to schedule meeting', 'error');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Update Meeting' : 'Schedule Meeting'; }
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Update Meeting' : 'Schedule Meeting'; }
        }
    });

    // Wire CC events with refresh callback
    const refreshMeetCCSection = async () => {
        try {
            const ccRes = await apiGet('/api/campaigns/cc-emails-for-send?scope=meetings');
            if (ccRes && ccRes.ok) {
                meetCCData = await ccRes.json();
                const container = document.getElementById('meetCC');
                if (container) {
                    container.outerHTML = buildCCSectionHTML('meetCC', meetCCData.admin_cc, meetCCData.user_cc);
                    wireCCEvents('meetCC', refreshMeetCCSection);
                }
            }
        } catch (_) {}
    };
    wireCCEvents('meetCC', refreshMeetCCSection);

    // Set initial button label after modal renders
    setTimeout(() => {
        const saveBtn = document.getElementById('modalSave');
        if (saveBtn) saveBtn.textContent = isEdit ? 'Update Meeting' : 'Schedule Meeting';
    }, 50);
}

// ──────────────────────────────────────────────
//  Meeting Details Modal
// ──────────────────────────────────────────────
async function showMeetingDetailsModal(leadId, leadName) {
    // Show loading placeholder first
    showModal('📅 Meeting Details', `
        <div style="text-align:center;padding:48px;color:#6B7280;">
            <div style="font-size:2rem;margin-bottom:12px;">⏳</div>
            Loading meeting details...
        </div>
    `);

    try {
        const res = await apiGet(`/api/campaigns/meeting/${leadId}`);
        if (!res || !res.ok) {
            showToast('Could not load meeting details', 'error');
            const overlay = document.querySelector('.modal-overlay');
            if (overlay) overlay.remove();
            return;
        }
        const m = await res.json();
        _currentMeetingData = m; // Store for edit use

        // Format date/time for display
        const startDt = new Date(m.start_datetime);
        const dateStr = startDt.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        const timeStr = startDt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const safeEmail = (m.attendee_email || '').replace(/'/g, "\\'");
        const safeTitle = (m.title || '').replace(/'/g, "\\'");

        const html = `
            <!-- Header card -->
            <div style="background:linear-gradient(135deg,#EFF6FF,#F0FDF4);border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #DBEAFE;text-align:center;">
                <div style="font-size:2rem;margin-bottom:8px;">📅</div>
                <h3 style="color:#1D4ED8;margin:0 0 6px;font-size:1.1rem;">${m.title}</h3>
                <p style="color:#6B7280;font-size:0.875rem;margin:0;">${dateStr}</p>
                <p style="color:#6B7280;font-size:0.875rem;margin:4px 0 0;">🕐 ${timeStr}</p>
                ${m.booked_by === 'client' ? `
                <div style="margin-top:10px;">
                    <span style="display:inline-block;padding:4px 12px;background:linear-gradient(135deg,#8B5CF6,#7C3AED);color:white;border-radius:20px;font-size:0.75rem;font-weight:600;">
                        🔗 Booked by Client
                    </span>
                </div>` : ''}
            </div>

            <!-- Info rows -->
            <div style="display:grid;gap:10px;margin-bottom:20px;">
                <div style="display:flex;gap:12px;align-items:center;padding:12px 14px;background:#F9FAFB;border-radius:8px;border:1px solid #F3F4F6;">
                    <span style="font-size:1.25rem;">⏱️</span>
                    <div>
                        <div style="font-size:0.7rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:.05em;">Duration</div>
                        <div style="font-weight:600;color:#111827;">${m.duration_minutes} minutes</div>
                    </div>
                </div>
                ${m.attendee_email ? `
                <div style="display:flex;gap:12px;align-items:center;padding:12px 14px;background:#F9FAFB;border-radius:8px;border:1px solid #F3F4F6;">
                    <span style="font-size:1.25rem;">👤</span>
                    <div>
                        <div style="font-size:0.7rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:.05em;">Client Attendee</div>
                        <div style="font-weight:600;color:#111827;">${m.attendee_email}</div>
                    </div>
                </div>` : ''}
                ${m.salesperson_email ? `
                <div style="display:flex;gap:12px;align-items:center;padding:12px 14px;background:#EFF6FF;border-radius:8px;border:1px solid #DBEAFE;">
                    <span style="font-size:1.25rem;">💼</span>
                    <div>
                        <div style="font-size:0.7rem;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;">Salesperson Attendee</div>
                        <div style="font-weight:600;color:#1D4ED8;">${m.salesperson_email}</div>
                    </div>
                </div>` : ''}
                ${m.description ? `
                <div style="display:flex;gap:12px;align-items:flex-start;padding:12px 14px;background:#F9FAFB;border-radius:8px;border:1px solid #F3F4F6;">
                    <span style="font-size:1.25rem;">📝</span>
                    <div>
                        <div style="font-size:0.7rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:.05em;">Notes</div>
                        <div style="color:#374151;font-size:0.875rem;margin-top:2px;">${m.description}</div>
                    </div>
                </div>` : ''}
            </div>

            <!-- Google Meet link -->
            ${m.meet_link ? `
            <div style="padding:14px 16px;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                    <div style="min-width:0;">
                        <div style="font-size:0.7rem;color:#065F46;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">🔗 Google Meet Link</div>
                        <div style="font-size:0.8rem;color:#047857;word-break:break-all;">${m.meet_link}</div>
                    </div>
                    <button id="copyMeetLinkBtn"
                        onclick="copyMeetLink('${m.meet_link.replace(/'/g, "\\'")}')"
                        style="flex-shrink:0;padding:8px 14px;background:#059669;color:white;border:none;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;transition:background 0.2s;"
                    >📋 Copy</button>
                </div>
            </div>` : ''}

            <!-- Calendar link -->
            ${m.event_link ? `
            <div style="margin-bottom:20px;">
                <a href="${m.event_link}" target="_blank"
                   style="display:inline-flex;align-items:center;gap:6px;color:#2563EB;font-size:0.875rem;text-decoration:none;font-weight:500;">
                    📅 View in Google Calendar →
                </a>
            </div>` : ''}

            <!-- Action buttons -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;border-top:1px solid #E5E7EB;padding-top:16px;">
                <button
                    onclick="editMeetingFromDetails(${leadId}, '${leadName.replace(/'/g, "\\'")}', '${safeEmail}')"
                    style="padding:12px;background:#EFF6FF;border:1px solid #BFDBFE;color:#1D4ED8;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.875rem;transition:background 0.2s;"
                >✏️ Edit Meeting</button>
                <button
                    onclick="cancelMeetingConfirm(${leadId}, this)"
                    style="padding:12px;background:#FEF2F2;border:1px solid #FECACA;color:#DC2626;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.875rem;transition:background 0.2s;"
                >🗑️ Cancel Meeting</button>
            </div>
        `;

        // Replace loading content with real content
        const modalBody = document.querySelector('.modal-body');
        if (modalBody) modalBody.innerHTML = html;
        const modalHeader = document.querySelector('.modal-header h3');
        if (modalHeader) modalHeader.textContent = '📅 Meeting Details';

    } catch (err) {
        showToast('Error loading meeting details: ' + err.message, 'error');
        const overlay = document.querySelector('.modal-overlay');
        if (overlay) overlay.remove();
    }
}

// ──────────────────────────────────────────────
//  Edit Meeting (from details modal)
// ──────────────────────────────────────────────
function editMeetingFromDetails(leadId, leadName, leadEmail) {
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => {
            overlay.remove();
            showMeetingSchedulerModal(leadId, leadName, leadEmail, _currentMeetingData);
        }, 250);
    } else {
        showMeetingSchedulerModal(leadId, leadName, leadEmail, _currentMeetingData);
    }
}

// ──────────────────────────────────────────────
//  Copy Google Meet Link to Clipboard
// ──────────────────────────────────────────────
function copyMeetLink(link) {
    const btn = document.getElementById('copyMeetLinkBtn');

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
            showToast('Google Meet link copied!', 'success');
            if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000); }
        } catch (_) {
            showToast('Could not copy. Please copy manually.', 'error');
        }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(() => {
            showToast('Google Meet link copied to clipboard!', 'success');
            if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000); }
        }).catch(doFallback);
    } else {
        doFallback();
    }
}

// ──────────────────────────────────────────────
//  Cancel / Delete a Scheduled Meeting
// ──────────────────────────────────────────────
async function cancelMeetingConfirm(leadId, btn) {
    if (!confirm(
        'Are you sure you want to cancel this meeting?\n\n' +
        'This will remove the meeting record from the system. ' +
        'Please also delete the event from Google Calendar manually.\n\n' +
        'This action cannot be undone.'
    )) return;

    withLoadingState(btn, '🗑️...', async () => {
        try {
            const res = await apiDelete(`/api/campaigns/meeting/${leadId}`);
            if (res && res.ok) {
                showToast('Meeting cancelled successfully.', 'success');
                const overlay = document.querySelector('.modal-overlay');
                if (overlay) overlay.remove();
                await loadCampaigns();
                await loadCampaignStats();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to cancel meeting', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

// ──────────────────────────────────────────────
//  Copy Booking Link for a Lead
// ──────────────────────────────────────────────
async function copyBookingLink(leadId, btn) {
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳...';

    try {
        // Generate/get booking token
        const res = await apiGet(`/api/leads/${leadId}/booking-token`);
        if (!res || !res.ok) {
            const err = await res.json();
            showToast(err.detail || 'Failed to generate booking link', 'error');
            btn.disabled = false;
            btn.innerHTML = originalText;
            return;
        }

        const data = await res.json();
        const bookingUrl = `${window.location.origin}/book-meeting?lead_id=${leadId}&token=${data.token}`;

        // Copy to clipboard
        const doCopy = (text) => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(text);
            }
            // Fallback
            return new Promise((resolve, reject) => {
                const el = document.createElement('textarea');
                el.value = text;
                el.style.position = 'fixed';
                el.style.opacity = '0';
                document.body.appendChild(el);
                el.select();
                try {
                    document.execCommand('copy');
                    resolve();
                } catch (e) {
                    reject(e);
                } finally {
                    document.body.removeChild(el);
                }
            });
        };

        await doCopy(bookingUrl);

        if (data.used) {
            showToast('⚠️ Link copied but it has already been used. The client will see a message.', 'info');
        } else {
            showToast('Booking link copied to clipboard! Share it with the client.', 'success');
        }

        btn.innerHTML = '✅ Copied!';
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 2000);

    } catch (err) {
        showToast('Error: ' + err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

