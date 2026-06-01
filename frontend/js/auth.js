/**
 * auth.js — Login page logic and JWT token management.
 * 
 * Handles:
 *   - Form submission and validation
 *   - API call to /api/auth/login
 *   - JWT storage in localStorage
 *   - Redirect to dashboard on success
 *   - Auto-redirect if already authenticated
 */

// ──────────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────────
const API_BASE = window.location.origin;
const TOKEN_KEY = 'lms_token';
const USER_KEY = 'lms_user';

// ──────────────────────────────────────────────
//  Token Utilities (shared across pages)
// ──────────────────────────────────────────────

/**
 * Save the JWT token and user data to localStorage.
 */
function saveAuth(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Retrieve the stored JWT token.
 */
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

/**
 * Retrieve the stored user data.
 */
function getUser() {
    const data = localStorage.getItem(USER_KEY);
    return data ? JSON.parse(data) : null;
}

/**
 * Clear all auth data (logout).
 */
function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

/**
 * Check if user is currently authenticated.
 */
function isAuthenticated() {
    return !!getToken();
}

// ──────────────────────────────────────────────
//  Auto-redirect if already logged in
// ──────────────────────────────────────────────
if (isAuthenticated()) {
    window.location.href = '/dashboard';
}

// ──────────────────────────────────────────────
//  DOM Elements
// ──────────────────────────────────────────────
const loginForm = document.getElementById('loginForm');
const userIdInput = document.getElementById('userId');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginBtnText = document.getElementById('loginBtnText');
const loginError = document.getElementById('loginError');
const loginErrorText = document.getElementById('loginErrorText');

// ──────────────────────────────────────────────
//  Login Form Handler
// ──────────────────────────────────────────────
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const userId = userIdInput.value.trim();
    const password = passwordInput.value;

    // Basic client-side validation
    if (!userId || !password) {
        showError('Please enter both username and password.');
        return;
    }

    // Show loading state
    setLoading(true);
    hideError();

    try {
        // Call the login API
        const response = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                user_id: userId,
                password: password,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            // Show error from API
            throw new Error(data.detail || 'Login failed. Please try again.');
        }

        // Save token and user data
        saveAuth(data.access_token, data.user);

        // Redirect to dashboard
        window.location.href = '/dashboard';
    } catch (error) {
        showError(error.message);
    } finally {
        setLoading(false);
    }
});

// ──────────────────────────────────────────────
//  UI Helpers
// ──────────────────────────────────────────────

/**
 * Show an error message on the login form.
 */
function showError(message) {
    loginErrorText.textContent = message;
    loginError.classList.add('show');

    // Auto-hide after 5 seconds
    setTimeout(() => {
        hideError();
    }, 5000);
}

/**
 * Hide the error message.
 */
function hideError() {
    loginError.classList.remove('show');
}

/**
 * Toggle loading state on the submit button.
 */
function setLoading(isLoading) {
    if (isLoading) {
        loginBtn.disabled = true;
        loginBtnText.textContent = 'Signing in...';
    } else {
        loginBtn.disabled = false;
        loginBtnText.textContent = 'Sign In';
    }
}

// ──────────────────────────────────────────────
//  Enter key support (submit on Enter)
// ──────────────────────────────────────────────
passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        loginForm.dispatchEvent(new Event('submit'));
    }
});

// ──────────────────────────────────────────────
//  Password Visibility Toggle
// ──────────────────────────────────────────────
const passwordToggle = document.getElementById('passwordToggle');
if (passwordToggle) {
    passwordToggle.addEventListener('click', () => {
        const isHidden = passwordInput.type === 'password';
        passwordInput.type = isHidden ? 'text' : 'password';
        passwordToggle.textContent = isHidden ? '🙈' : '👁️';
        passwordToggle.title = isHidden ? 'Hide password' : 'Show password';
    });
}
