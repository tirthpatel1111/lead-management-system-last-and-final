/**
 * dashboard.js — Dashboard page logic.
 * Fetches stats from API and populates the dashboard cards.
 */

document.addEventListener('DOMContentLoaded', async () => {
    await loadDashboardStats();
    await loadRecentCampaigns();
});

/**
 * Fetch and display dashboard statistics.
 */
async function loadDashboardStats() {
    try {
        const res = await apiGet('/api/dashboard/stats');
        if (!res || !res.ok) return;
        const data = await res.json();

        // Lead stats
        document.getElementById('statLeads').textContent = data.leads.total || 0;
        document.getElementById('statNew').textContent = data.leads.new || 0;
        document.getElementById('statContacted').textContent = data.leads.contacted || 0;
        document.getElementById('statWon').textContent = data.leads.approved || 0;
        document.getElementById('statLost').textContent = data.leads.lost || 0;

        // Campaign stats
        document.getElementById('statCampaigns').textContent = data.campaigns.total || 0;
        document.getElementById('statEmails').textContent = data.campaigns.email || 0;
        document.getElementById('statWhatsApp').textContent = data.campaigns.whatsapp || 0;

        // Lead count badge in sidebar
        const leadBadge = document.getElementById('leadCount');
        if (leadBadge) leadBadge.textContent = data.leads.total || 0;

    } catch (err) {
        console.error('Failed to load dashboard stats:', err);
    }
}

/**
 * Load recent campaigns into the dashboard table.
 */
async function loadRecentCampaigns() {
    try {
        const res = await apiGet('/api/campaigns');
        if (!res || !res.ok) return;
        const campaigns = await res.json();

        const container = document.getElementById('recentCampaignsBody');
        if (!container) return;

        if (campaigns.length === 0) return; // Keep empty state

        // Show last 5 campaigns
        const recent = campaigns.slice(0, 5);
        container.innerHTML = `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Lead</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recent.map(c => `
                            <tr>
                                <td>${c.company_name || c.contact_name || c.lead_email || 'Unknown'}</td>
                                <td>${statusBadge(c.campaign_type)}</td>
                                <td>${statusBadge(c.status)}</td>
                                <td>${formatDate(c.created_at)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (err) {
        console.error('Failed to load recent campaigns:', err);
    }
}
