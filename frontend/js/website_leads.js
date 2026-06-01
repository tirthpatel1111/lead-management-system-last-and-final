/**
 * website_leads.js — Website Leads page logic.
 * Handles fetching website leads, tabs, rendering tables, and CSV export.
 */

let poshLeads = [];
let contactUsLeads = [];
let currentCategory = 'POSH';

document.addEventListener('DOMContentLoaded', async () => {
    await loadWebsiteLeads();
    setupActions();
});

async function loadWebsiteLeads() {
    try {
        const resPosh = await apiGet('/api/website-leads?category=POSH');
        if (resPosh.ok) poshLeads = await resPosh.json();

        const resContact = await apiGet('/api/website-leads?category=Contact Us');
        if (resContact.ok) contactUsLeads = await resContact.json();

        renderTables();
    } catch (err) {
        console.error('Failed to load website leads:', err);
    }
}

function renderTables() {
    // Render POSH
    const poshTbody = document.getElementById('poshTableBody');
    if (poshLeads.length === 0) {
        poshTbody.innerHTML = '<tr><td colspan="12" class="text-center" style="padding:40px;color:#9CA3AF;">No POSH leads found.</td></tr>';
    } else {
        poshTbody.innerHTML = poshLeads.map(lead => {
            const d = lead.full_data || {};
            return `
                <tr>
                    <td><strong>${d.name || d.contact_person || '—'}</strong></td>
                    <td>${d.company_name || d.company || '—'}</td>
                    <td>${d.email_id || d.email || '—'}</td>
                    <td>${d.phone || '—'}</td>
                    <td>${d.city || '—'}</td>
                    <td>${d.services_interested_in || '—'}</td>
                    <td>${d.posh_interest || '—'}</td>
                    <td>${d.training_mode || '—'}</td>
                    <td>${d.number_of_employees || '—'}</td>
                    <td>${d.preferred_timeline || '—'}</td>
                    <td style="max-width: 200px; white-space: normal;">${d.requirement_message || '—'}</td>
                    <td>${formatDate(lead.created_at)}</td>
                </tr>
            `;
        }).join('');
    }

    // Render Contact Us
    const contactTbody = document.getElementById('contactUsTableBody');
    if (contactUsLeads.length === 0) {
        contactTbody.innerHTML = '<tr><td colspan="10" class="text-center" style="padding:40px;color:#9CA3AF;">No Contact Us leads found.</td></tr>';
    } else {
        contactTbody.innerHTML = contactUsLeads.map(lead => {
            const d = lead.full_data || {};
            return `
                <tr>
                    <td><strong>${d.name || d.contact_person || '—'}</strong></td>
                    <td>${d.company_name || d.company || '—'}</td>
                    <td>${d.email_id || d.email || '—'}</td>
                    <td>${d.phone || '—'}</td>
                    <td>${d.city || '—'}</td>
                    <td>${d.website || '—'}</td>
                    <td>${d.turnover || '—'}</td>
                    <td>${d.employee_size || '—'}</td>
                    <td style="max-width: 200px; white-space: normal;">${d.requirement_message || '—'}</td>
                    <td>${formatDate(lead.created_at)}</td>
                </tr>
            `;
        }).join('');
    }
}

function setupActions() {
    const btnTabPOSH = document.getElementById('btnTabPOSH');
    const btnTabContactUs = document.getElementById('btnTabContactUs');
    const containerPOSH = document.getElementById('tableContainerPOSH');
    const containerContactUs = document.getElementById('tableContainerContactUs');

    btnTabPOSH.addEventListener('click', () => {
        currentCategory = 'POSH';
        btnTabPOSH.classList.replace('btn-secondary', 'btn-primary');
        btnTabContactUs.classList.replace('btn-primary', 'btn-secondary');
        containerPOSH.classList.remove('hidden');
        containerContactUs.classList.add('hidden');
    });

    btnTabContactUs.addEventListener('click', () => {
        currentCategory = 'Contact Us';
        btnTabContactUs.classList.replace('btn-secondary', 'btn-primary');
        btnTabPOSH.classList.replace('btn-primary', 'btn-secondary');
        containerContactUs.classList.remove('hidden');
        containerPOSH.classList.add('hidden');
    });

    document.getElementById('btnExportCSV').addEventListener('click', exportToCSV);
}

function exportToCSV() {
    let leads = currentCategory === 'POSH' ? poshLeads : contactUsLeads;
    if (leads.length === 0) {
        showToast('No data to export', 'error');
        return;
    }

    let csvContent = "";
    let headers = [];
    
    if (currentCategory === 'POSH') {
        headers = ["Name", "Company", "Email", "Phone", "City", "Services", "POSH Interest", "Training Mode", "Employees", "Timeline", "Message", "Date"];
    } else {
        headers = ["Name", "Company", "Email", "Phone", "City", "Website", "Turnover", "Employees", "Message", "Date"];
    }
    
    csvContent += headers.join(",") + "\n";

    leads.forEach(lead => {
        const d = lead.full_data || {};
        let row = [];
        
        if (currentCategory === 'POSH') {
            row = [
                d.name || d.contact_person || '',
                d.company_name || d.company || '',
                d.email_id || d.email || '',
                d.phone || '',
                d.city || '',
                d.services_interested_in || '',
                d.posh_interest || '',
                d.training_mode || '',
                d.number_of_employees || '',
                d.preferred_timeline || '',
                d.requirement_message || '',
                formatDate(lead.created_at)
            ];
        } else {
            row = [
                d.name || d.contact_person || '',
                d.company_name || d.company || '',
                d.email_id || d.email || '',
                d.phone || '',
                d.city || '',
                d.website || '',
                d.turnover || '',
                d.employee_size || '',
                d.requirement_message || '',
                formatDate(lead.created_at)
            ];
        }

        // Escape quotes and wrap in quotes to handle commas in values
        const escapedRow = row.map(v => {
            const stringValue = String(v).replace(/"/g, '""');
            return `"${stringValue}"`;
        });
        
        csvContent += escapedRow.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `website_leads_${currentCategory.replace(' ', '_').toLowerCase()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
