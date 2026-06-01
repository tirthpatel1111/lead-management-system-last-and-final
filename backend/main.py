"""
Lead Management System — FastAPI Application Entry Point.

This is the main application file that:
  1. Creates the FastAPI app instance
  2. Configures CORS for frontend communication
  3. Mounts static files (frontend)
  4. Includes all API routers
  5. Initializes the database and seeds admin on startup
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.config import FRONTEND_DIR, UPLOAD_DIR
from backend.database import init_db, get_db
from backend.services.user_service import seed_admin
from backend.routes import auth, leads, campaigns, dashboard, website_leads
from backend.routes import booking as booking_routes
from backend.routes import tracking as tracking_routes

import aiosqlite
from backend.config import DB_PATH


import asyncio
from backend.services.imap_service import process_incoming_emails

# ──────────────────────────────────────────────
#  Application Lifespan (startup / shutdown)
# ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Runs on application startup and shutdown.
    - Startup: Initialize database tables, seed admin account, start bg workers
    - Shutdown: Cleanup (if needed)
    """
    print("[*] Starting Lead Management System...")

    # Ensure upload directory exists
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # Initialize database tables
    await init_db()

    # Seed default admin account if none exists
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        await seed_admin(db)
    finally:
        await db.close()

    # Start IMAP background worker loop (runs every 3 mins)
    async def imap_worker_loop():
        while True:
            try:
                await process_incoming_emails()
            except Exception as e:
                print(f"[IMAP] Worker loop error: {e}")
            await asyncio.sleep(180)  # 3 minutes

    bg_task = asyncio.create_task(imap_worker_loop())

    print("[OK] System ready!")
    yield
    print("[*] Shutting down Lead Management System...")
    bg_task.cancel()

# ──────────────────────────────────────────────
#  FastAPI App Instance
# ──────────────────────────────────────────────
app = FastAPI(
    title="Lead Management System",
    description="Internal lead management and campaign tool for consulting companies",
    version="1.0.0",
    lifespan=lifespan,
)

# ──────────────────────────────────────────────
#  CORS Configuration
# ──────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Internal tool — allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────
#  API Routers
# ──────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(leads.router)
app.include_router(campaigns.router)
app.include_router(dashboard.router)
app.include_router(website_leads.router)
app.include_router(booking_routes.router)
app.include_router(tracking_routes.router)

# ──────────────────────────────────────────────
#  Static File Serving (Frontend)
# ──────────────────────────────────────────────
# Mount frontend static assets (CSS, JS)
app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")


@app.get("/")
async def serve_login():
    """Serve the login page as the root route."""
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/dashboard")
async def serve_dashboard():
    """Serve the dashboard page."""
    return FileResponse(os.path.join(FRONTEND_DIR, "dashboard.html"))


@app.get("/leads")
async def serve_leads():
    """Serve the leads management page."""
    return FileResponse(os.path.join(FRONTEND_DIR, "leads.html"))


@app.get("/campaigns")
async def serve_campaigns():
    """Serve the campaigns page."""
    return FileResponse(os.path.join(FRONTEND_DIR, "campaigns.html"))


@app.get("/ocr")
async def serve_ocr():
    """Serve the OCR scanning page."""
    return FileResponse(os.path.join(FRONTEND_DIR, "ocr.html"))


@app.get("/admin")
async def serve_admin():
    """Serve the admin panel page."""
    return FileResponse(os.path.join(FRONTEND_DIR, "admin.html"))


@app.get("/website-leads")
async def serve_website_leads():
    """Serve the website leads page."""
    return FileResponse(os.path.join(FRONTEND_DIR, "website_leads.html"))


@app.get("/usage")
async def serve_usage():
    """Serve the usage monitoring page."""
    return FileResponse(os.path.join(FRONTEND_DIR, "usage.html"))


@app.get("/book-meeting")
async def serve_book_meeting():
    """Serve the public booking page (no auth required)."""
    return FileResponse(os.path.join(FRONTEND_DIR, "book_meeting.html"))


@app.get("/booking-confirmed")
async def serve_booking_confirmed():
    """Serve the booking confirmation page (no auth required)."""
    return FileResponse(os.path.join(FRONTEND_DIR, "booking_confirmed.html"))
