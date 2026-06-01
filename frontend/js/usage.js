/**
 * usage.js — Usage monitoring page logic.
 * Displays global and personal email campaign usage with progress bars.
 * Admin users can configure the daily email limit.
 */

document.addEventListener('DOMContentLoaded', async () => {
    await loadUsageData();
    await loadOpenRateData();
    setupAdminLimitCard();

    // Auto-refresh every 60 seconds
    setInterval(() => {
        loadUsageData();
        loadOpenRateData();
    }, 60000);
});


async function loadUsageData() {
    try {
        const res = await apiGet('/api/campaigns/usage');
        if (!res || !res.ok) return;
        const data = await res.json();

        const limit = data.daily_limit || 500;
        const totalSent = data.total_sent_today || 0;
        const remaining = data.remaining || 0;
        const userSent = data.user_sent_today || 0;
        const userName = data.user_name || 'You';
        const dateStr = data.date || '—';

        // ── Global Usage ──
        document.getElementById('globalSentCount').textContent = totalSent;
        document.getElementById('globalLimitCount').textContent = limit;
        document.getElementById('globalRemainingCount').textContent = remaining;

        const globalPercent = limit > 0 ? Math.min(100, Math.round((totalSent / limit) * 100)) : 0;
        const globalFill = document.getElementById('globalProgressFill');
        globalFill.style.width = globalPercent + '%';
        globalFill.className = 'progress-bar-fill ' + getProgressColorClass(globalPercent);

        document.getElementById('globalProgressPercent').textContent = globalPercent + '%';
        document.getElementById('globalProgressText').textContent = `${totalSent} / ${limit} emails`;

        // ── User Usage ──
        document.getElementById('usageUserName').textContent = userName;
        document.getElementById('userSentCount').textContent = userSent;

        const userPercent = limit > 0 ? Math.min(100, Math.round((userSent / limit) * 100)) : 0;
        const userFill = document.getElementById('userProgressFill');
        userFill.style.width = userPercent + '%';
        userFill.className = 'progress-bar-fill user-progress-fill ' + getProgressColorClass(userPercent);

        document.getElementById('userProgressPercent').textContent = userPercent + '%';
        document.getElementById('userProgressText').textContent = `${userSent} / ${limit} emails`;

        // ── Date ──
        document.getElementById('usageDate').textContent = dateStr;

        // ── Alert Banner ──
        const alertBanner = document.getElementById('usageAlertBanner');
        if (remaining === 0) {
            alertBanner.innerHTML = `
                <div class="usage-alert usage-alert-danger">
                    <span style="font-size:1.25rem;">🚫</span>
                    <div>
                        <strong>Daily Limit Reached!</strong>
                        <p style="margin:4px 0 0;font-size:0.8125rem;">All ${limit} email campaigns have been sent today. The limit will reset at midnight IST.</p>
                    </div>
                </div>
            `;
            alertBanner.style.display = 'block';
        } else if (globalPercent >= 80) {
            alertBanner.innerHTML = `
                <div class="usage-alert usage-alert-warning">
                    <span style="font-size:1.25rem;">⚠️</span>
                    <div>
                        <strong>Approaching Daily Limit</strong>
                        <p style="margin:4px 0 0;font-size:0.8125rem;">Only ${remaining} emails remaining out of ${limit}. Use them wisely!</p>
                    </div>
                </div>
            `;
            alertBanner.style.display = 'block';
        } else {
            alertBanner.style.display = 'none';
        }

        // ── Admin Limit Input ──
        const adminInput = document.getElementById('adminLimitInput');
        if (adminInput && !adminInput.matches(':focus')) {
            adminInput.value = limit;
        }

    } catch (err) {
        console.error('Failed to load usage data:', err);
    }
}


function getProgressColorClass(percent) {
    if (percent >= 100) return 'progress-danger';
    if (percent >= 80) return 'progress-warning';
    if (percent >= 50) return 'progress-amber';
    return 'progress-safe';
}


function setupAdminLimitCard() {
    const user = getUser();
    if (!user || user.role !== 'admin') return;

    const card = document.getElementById('adminLimitCard');
    if (card) card.style.display = 'block';

    const btnSave = document.getElementById('btnSaveLimit');
    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const input = document.getElementById('adminLimitInput');
            const newLimit = parseInt(input.value);

            if (!newLimit || newLimit < 1) {
                showToast('Limit must be at least 1', 'error');
                return;
            }

            withLoadingState(btnSave, '💾 Saving...', async () => {
                try {
                    const res = await apiPost('/api/campaigns/settings/daily-email-limit', { limit: newLimit });
                    if (res && res.ok) {
                        showToast(`Daily email limit updated to ${newLimit}`, 'success');
                        await loadUsageData();
                    } else {
                        const err = await res.json();
                        showToast(err.detail || 'Failed to update limit', 'error');
                    }
                } catch (err) {
                    showToast('Error: ' + err.message, 'error');
                }
            });
        });
    }
}


async function loadOpenRateData() {
    try {
        const res = await apiGet('/api/campaigns/open-rate');
        if (!res || !res.ok) return;
        const data = await res.json();

        const totalSent = data.total_sent || 0;
        const totalOpened = data.total_opened || 0;
        const openRate = data.open_rate || 0;

        // Update stat values
        document.getElementById('openRateSent').textContent = totalSent;
        document.getElementById('openRateOpened').textContent = totalOpened;

        const rateEl = document.getElementById('openRatePercent');
        rateEl.textContent = openRate + '%';
        // Color the rate based on value
        rateEl.className = 'open-rate-stat-value ' + getOpenRateColorClass(openRate);

        // Progress bar
        const progressFill = document.getElementById('openRateProgressFill');
        progressFill.style.width = Math.min(100, openRate) + '%';

        document.getElementById('openRateProgressPercent').textContent = openRate + '%';
        document.getElementById('openRateProgressText').textContent = `${totalOpened} / ${totalSent} opened`;

        // Admin: per-user breakdown
        const perUserSection = document.getElementById('openRatePerUser');
        if (data.per_user && data.per_user.length > 0) {
            perUserSection.style.display = 'block';
            const tbody = document.getElementById('openRateUserTableBody');
            tbody.innerHTML = data.per_user.map(u => {
                const badgeClass = getRateBadgeClass(u.rate);
                return `
                    <tr>
                        <td><strong>${u.user_name || 'User #' + u.user_id}</strong></td>
                        <td>${u.sent}</td>
                        <td>${u.opened}</td>
                        <td><span class="rate-badge ${badgeClass}">${u.rate}%</span></td>
                    </tr>
                `;
            }).join('');
        } else {
            perUserSection.style.display = 'none';
        }

    } catch (err) {
        console.error('Failed to load open rate data:', err);
    }
}


function getOpenRateColorClass(rate) {
    if (rate >= 40) return 'rate-green';
    if (rate >= 15) return 'rate-amber';
    if (rate > 0) return 'rate-red';
    return '';
}


function getRateBadgeClass(rate) {
    if (rate >= 40) return 'rate-badge-green';
    if (rate >= 15) return 'rate-badge-amber';
    if (rate > 0) return 'rate-badge-red';
    return 'rate-badge-gray';
}
