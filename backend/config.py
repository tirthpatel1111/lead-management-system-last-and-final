"""
Configuration settings for the Lead Management System.
All app-wide constants and paths are defined here.
"""

import os

# ──────────────────────────────────────────────
#  Base Paths
# ──────────────────────────────────────────────
# Root directory of the project (one level up from /backend)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# SQLite database file location
DB_PATH = os.path.join(BASE_DIR, "data", "leads.db")

# Directory for user-uploaded files (visiting cards, Excel sheets, etc.)
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

# Frontend static files directory
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# ──────────────────────────────────────────────
#  JWT / Authentication Settings
# ──────────────────────────────────────────────
# Secret key for signing JWT tokens
# NOTE: Replace this with an environment variable in production!
SECRET_KEY = "lead-mgmt-secret-key-change-in-production-2024"

# JWT algorithm
ALGORITHM = "HS256"

# Token expiry in minutes (24 hours)
ACCESS_TOKEN_EXPIRE_MINUTES = 1440

# ──────────────────────────────────────────────
#  Default Admin Credentials (first-time setup)
# ──────────────────────────────────────────────
DEFAULT_ADMIN_USER_ID = "admin"
DEFAULT_ADMIN_PASSWORD = "admin123"
DEFAULT_ADMIN_NAME = "System Administrator"
DEFAULT_ADMIN_EMAIL = "admin@company.com"
