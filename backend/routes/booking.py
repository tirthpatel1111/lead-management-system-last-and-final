"""
Public Booking Routes — Allow clients to self-book meetings via a unique link.
No authentication required — these endpoints are public-facing.
Token-based validation ensures only valid booking links work.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import aiosqlite
from datetime import datetime

from backend.database import get_db
from backend.services.lead_service import get_lead_by_id
from backend.services.google_calendar_service import schedule_meeting, is_gcal_configured
from backend.services.email_service import send_email
from backend.services.user_service import get_user_by_id
from backend.services.campaign_service import validate_meeting_slot, get_office_hours

router = APIRouter(prefix="/api/booking", tags=["Public Booking"])


# ──────────────────────────────────────────────
#  Validate Booking Link
# ──────────────────────────────────────────────
@router.get("/validate")
async def validate_booking_link(
    lead_id: int,
    token: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Validate a booking link token. Public endpoint — no auth required.
    Returns lead info if valid, or an error reason if not.
    """
    if not lead_id or not token:
        return {"valid": False, "reason": "Missing lead_id or token."}

    lead = await get_lead_by_id(db, lead_id)
    if not lead:
        return {"valid": False, "reason": "Invalid booking link."}

    # Check token matches and is unused
    if lead.get("booking_token") != token:
        return {"valid": False, "reason": "Invalid or expired booking link."}

    if lead.get("booking_token_used"):
        return {"valid": False, "reason": "This booking link has already been used."}

    # Check if a meeting already exists for this lead
    cursor = await db.execute(
        "SELECT id FROM meetings WHERE lead_id = ?", (lead_id,)
    )
    existing_meeting = await cursor.fetchone()
    if existing_meeting:
        return {"valid": False, "reason": "A meeting has already been scheduled for this inquiry."}

    # Fetch salesperson info for display
    salesperson_name = "Our Team"
    if lead.get("owner_id"):
        sp = await get_user_by_id(db, lead["owner_id"])
        if sp:
            salesperson_name = sp.get("full_name", "Our Team")

    return {
        "valid": True,
        "company_name": lead.get("company_name", ""),
        "contact_name": lead.get("contact_name", ""),
        "email": lead.get("email", ""),
        "salesperson_name": salesperson_name,
    }


# ──────────────────────────────────────────────
#  Submit Booking Form
# ──────────────────────────────────────────────
class BookingSubmit(BaseModel):
    lead_id: int
    token: str
    title: str
    start_datetime: str  # "YYYY-MM-DDTHH:MM:SS"
    duration_minutes: int = 60
    notes: Optional[str] = ""
    client_name: Optional[str] = ""
    client_email: Optional[str] = ""


@router.post("/submit")
async def submit_booking(
    body: BookingSubmit,
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Submit a booking form. Public endpoint — no auth required.
    Validates token, creates GCal event, inserts meeting record,
    marks token as used, and sends notification emails.
    """
    # ── 1. Re-validate token ──
    lead = await get_lead_by_id(db, body.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Invalid booking link.")

    if lead.get("booking_token") != body.token:
        raise HTTPException(status_code=400, detail="Invalid or expired booking link.")

    if lead.get("booking_token_used"):
        raise HTTPException(status_code=400, detail="This booking link has already been used.")

    # Check for existing meeting
    cursor = await db.execute(
        "SELECT id FROM meetings WHERE lead_id = ?", (body.lead_id,)
    )
    if await cursor.fetchone():
        raise HTTPException(
            status_code=400,
            detail="A meeting has already been scheduled for this inquiry."
        )

    # ── 2. Validate required fields ──
    if not body.title or not body.title.strip():
        raise HTTPException(status_code=400, detail="Meeting title is required.")
    if not body.start_datetime or not body.start_datetime.strip():
        raise HTTPException(status_code=400, detail="Meeting date and time are required.")
    if body.duration_minutes not in (30, 60, 90, 120):
        raise HTTPException(status_code=400, detail="Invalid duration. Choose 30, 60, 90, or 120 minutes.")

    # Validate start_datetime format
    try:
        start_dt = datetime.fromisoformat(body.start_datetime)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date/time format.")

    # ── 3. Resolve attendee emails ──
    attendee_email = body.client_email or lead.get("email", "")
    if not attendee_email:
        raise HTTPException(
            status_code=400,
            detail="Client email is required to send the calendar invite."
        )

    # Get salesperson email
    salesperson_email = ""
    if lead.get("owner_id"):
        sp = await get_user_by_id(db, lead["owner_id"])
        if sp:
            salesperson_email = sp.get("email", "")

    # Build CC list from admin defaults (meeting scope)
    meeting_cc_list = []
    cursor = await db.execute("SELECT email FROM cc_emails WHERE scope_meetings = 1")
    admin_meeting_ccs = [row["email"] for row in await cursor.fetchall()]
    meeting_cc_list.extend(admin_meeting_ccs)
    # Deduplicate
    meeting_cc_list = list(dict.fromkeys(
        [e.strip().lower() for e in meeting_cc_list if e and e.strip()]
    ))

    # ── 3.5. Validate meeting slot (office hours + overlap + buffer) ──
    # Check is against the LEAD'S OWNER (salesperson) schedule
    owner_id = lead.get("owner_id")
    if owner_id:
        validation = await validate_meeting_slot(
            db,
            owner_id=owner_id,
            start_datetime=body.start_datetime,
            duration_minutes=body.duration_minutes,
        )
        if not validation["valid"]:
            raise HTTPException(status_code=400, detail=validation["reason"])

    # ── 4. Create Google Calendar event ──
    if not is_gcal_configured():
        raise HTTPException(
            status_code=503,
            detail="Calendar integration is not configured. Please contact the team."
        )

    result = schedule_meeting(
        title=body.title,
        description=body.notes or f"Meeting booked by client via booking link.",
        start_datetime=body.start_datetime,
        duration_minutes=body.duration_minutes,
        attendee_email=attendee_email,
        salesperson_email=salesperson_email or None,
        cc_emails=meeting_cc_list if meeting_cc_list else None,
    )

    if not result.get("success"):
        raise HTTPException(
            status_code=503,
            detail=result.get("message", "Failed to create calendar event.")
        )

    # ── 5. Insert meeting record ──
    now = datetime.utcnow().isoformat()
    await db.execute(
        """
        INSERT INTO meetings
            (lead_id, owner_id, title, description, start_datetime, duration_minutes,
             attendee_email, salesperson_email, event_id, event_link, meet_link,
             booked_by, booked_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'client', ?, ?, ?)
        ON CONFLICT(lead_id) DO UPDATE SET
            title=excluded.title,
            description=excluded.description,
            start_datetime=excluded.start_datetime,
            duration_minutes=excluded.duration_minutes,
            attendee_email=excluded.attendee_email,
            salesperson_email=excluded.salesperson_email,
            event_id=excluded.event_id,
            event_link=excluded.event_link,
            meet_link=excluded.meet_link,
            booked_by=excluded.booked_by,
            booked_at=excluded.booked_at,
            updated_at=excluded.updated_at
        """,
        (
            body.lead_id,
            lead.get("owner_id", 1),
            body.title,
            body.notes or "",
            body.start_datetime,
            body.duration_minutes,
            attendee_email,
            salesperson_email or "",
            result.get("event_id", ""),
            result.get("event_link", ""),
            result.get("meet_link", ""),
            now,
            now,
            now,
        ),
    )

    # ── 6. Mark token as used ──
    await db.execute(
        "UPDATE leads SET booking_token_used = 1 WHERE id = ?",
        (body.lead_id,),
    )

    # ── 7. Auto-update lead status to 'won' if not already ──
    if lead.get("status") not in ("won",):
        await db.execute(
            "UPDATE leads SET status = 'won', updated_at = ? WHERE id = ?",
            (now, body.lead_id),
        )

    await db.commit()

    return {
        "success": True,
        "meet_link": result.get("meet_link"),
        "event_link": result.get("event_link"),
        "event_id": result.get("event_id"),
        "message": "Meeting booked successfully!",
        "lead_id": body.lead_id,
    }


# ──────────────────────────────────────────────
#  Get Confirmation Details
# ──────────────────────────────────────────────
@router.get("/confirmation/{lead_id}")
async def get_booking_confirmation(
    lead_id: int,
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Fetch meeting details for the booking success page. Public endpoint.
    Only returns data if the booking token was used (meeting was booked).
    """
    lead = await get_lead_by_id(db, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Booking not found.")

    if not lead.get("booking_token_used"):
        raise HTTPException(status_code=404, detail="No booking found for this link.")

    cursor = await db.execute(
        "SELECT * FROM meetings WHERE lead_id = ?", (lead_id,)
    )
    meeting = await cursor.fetchone()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting details not found.")

    m = dict(meeting)
    return {
        "title": m.get("title", ""),
        "start_datetime": m.get("start_datetime", ""),
        "duration_minutes": m.get("duration_minutes", 60),
        "meet_link": m.get("meet_link", ""),
        "event_link": m.get("event_link", ""),
        "attendee_email": m.get("attendee_email", ""),
        "booked_by": m.get("booked_by", "client"),
    }


# ──────────────────────────────────────────────
#  Public Office Hours (for booking page time picker)
# ──────────────────────────────────────────────
@router.get("/office-hours")
async def get_public_office_hours(
    db: aiosqlite.Connection = Depends(get_db),
):
    """Public endpoint — returns office hours for the booking page."""
    office = await get_office_hours(db)
    return {
        "start_time": office["start_time"],
        "end_time": office["end_time"],
    }
