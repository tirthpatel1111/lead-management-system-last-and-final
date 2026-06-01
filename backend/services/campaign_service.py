"""
Campaign Service — handles email and WhatsApp campaign operations.
Manages campaign creation, sending, and logging.
"""

import aiosqlite
from datetime import datetime, timezone, timedelta

# IST timezone offset (UTC+5:30)
IST = timezone(timedelta(hours=5, minutes=30))

# Default daily email campaign limit
DEFAULT_DAILY_EMAIL_LIMIT = 500


async def get_daily_email_limit(db: aiosqlite.Connection) -> int:
    """
    Get the admin-configurable daily email campaign limit from system_settings.
    Falls back to DEFAULT_DAILY_EMAIL_LIMIT if not set.
    """
    cursor = await db.execute(
        "SELECT value FROM system_settings WHERE key = 'daily_email_limit'"
    )
    row = await cursor.fetchone()
    if row:
        try:
            return int(row["value"])
        except (ValueError, TypeError):
            pass
    return DEFAULT_DAILY_EMAIL_LIMIT


async def get_daily_email_usage(
    db: aiosqlite.Connection, user_id: int = None
) -> dict:
    """
    Get daily email campaign usage stats.
    Uses IST (UTC+5:30) for the daily boundary so the counter resets at midnight IST.

    Returns:
        {
            "daily_limit": 500,
            "total_sent_today": N,
            "remaining": 500 - N,
            "user_sent_today": M,     (only if user_id provided)
            "date": "2026-05-07"
        }
    """
    # Get current date in IST
    now_ist = datetime.now(IST)
    today_ist = now_ist.strftime("%Y-%m-%d")

    # IST day boundaries in UTC for the SQL query
    # IST midnight = UTC 18:30 previous day
    # NOTE: sent_at is stored via isoformat() which uses 'T' separator,
    # so we must use 'T' separator here too for correct SQLite string comparison.
    ist_midnight_utc = (
        datetime(now_ist.year, now_ist.month, now_ist.day, tzinfo=IST)
        .astimezone(timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%S")
    )
    ist_end_utc = (
        datetime(now_ist.year, now_ist.month, now_ist.day, tzinfo=IST)
        + timedelta(days=1)
    ).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    daily_limit = await get_daily_email_limit(db)

    # Total sent today (all users, email campaigns only, status='sent')
    cursor = await db.execute(
        """
        SELECT COUNT(*) as count FROM campaigns
        WHERE campaign_type = 'email'
          AND status = 'sent'
          AND sent_at >= ?
          AND sent_at < ?
        """,
        (ist_midnight_utc, ist_end_utc),
    )
    total_row = await cursor.fetchone()
    total_sent = total_row["count"] if total_row else 0

    result = {
        "daily_limit": daily_limit,
        "total_sent_today": total_sent,
        "remaining": max(0, daily_limit - total_sent),
        "date": today_ist,
    }

    # Per-user usage (if user_id provided)
    if user_id is not None:
        cursor = await db.execute(
            """
            SELECT COUNT(*) as count FROM campaigns
            WHERE campaign_type = 'email'
              AND status = 'sent'
              AND sent_at >= ?
              AND sent_at < ?
              AND owner_id = ?
            """,
            (ist_midnight_utc, ist_end_utc, user_id),
        )
        user_row = await cursor.fetchone()
        result["user_sent_today"] = user_row["count"] if user_row else 0

    return result


async def check_email_quota(db: aiosqlite.Connection, count: int = 1) -> bool:
    """
    Check if `count` more email campaigns can be sent today.
    Returns True if quota allows, False if limit would be exceeded.
    """
    usage = await get_daily_email_usage(db)
    return usage["remaining"] >= count


async def get_campaign_counts_by_lead(
    db: aiosqlite.Connection, user_id: int, role: str
) -> dict:
    """
    Get the number of campaign attempts per lead, grouped by type.
    Counts ALL campaign attempts (sent + failed) so users can see
    how many times they tried contacting each lead.
    Salesperson sees only their own; admin sees all.

    Returns:
        { "12": {"email": 2, "whatsapp": 1}, "15": {"email": 0, "whatsapp": 3} }
    """
    query = """
        SELECT lead_id, campaign_type, COUNT(*) as count
        FROM campaigns
        WHERE 1=1
    """
    params = []

    if role != "admin":
        query += " AND owner_id = ?"
        params.append(user_id)

    query += " GROUP BY lead_id, campaign_type"

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()

    result = {}
    for row in rows:
        lead_id = str(row["lead_id"])
        ctype = row["campaign_type"]
        if lead_id not in result:
            result[lead_id] = {"email": 0, "whatsapp": 0, "website": 0}
        result[lead_id][ctype] = row["count"]

    return result


async def create_campaign(
    db: aiosqlite.Connection,
    lead_id: int,
    owner_id: int,
    campaign_type: str,
    subject: str = None,
    message: str = "",
    status: str = "pending",
) -> dict:
    """
    Create a new campaign record in the database.
    """
    cursor = await db.execute(
        """
        INSERT INTO campaigns (lead_id, owner_id, campaign_type, subject, message, status)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (lead_id, owner_id, campaign_type, subject, message, status),
    )
    await db.commit()
    campaign_id = cursor.lastrowid
    return await get_campaign_by_id(db, campaign_id)


async def get_campaign_by_id(db: aiosqlite.Connection, campaign_id: int) -> dict | None:
    """Retrieve a single campaign by ID."""
    cursor = await db.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,))
    row = await cursor.fetchone()
    return dict(row) if row else None


async def update_campaign_status(
    db: aiosqlite.Connection,
    campaign_id: int,
    status: str,
    error_message: str = None,
) -> dict:
    """
    Update campaign status after sending attempt.
    Sets sent_at timestamp on success.
    """
    sent_at = datetime.utcnow().isoformat() if status == "sent" else None
    await db.execute(
        """
        UPDATE campaigns 
        SET status = ?, sent_at = ?, error_message = ?
        WHERE id = ?
        """,
        (status, sent_at, error_message, campaign_id),
    )
    await db.commit()
    return await get_campaign_by_id(db, campaign_id)


async def get_campaigns_for_user(
    db: aiosqlite.Connection,
    user_id: int,
    role: str,
    campaign_type: str = None,
    campaign_status: str = None,
) -> list:
    """
    Retrieve campaigns filtered by owner.
    Admin sees all; salesperson sees only their own.
    Includes lead info via JOIN.
    Supports optional campaign_type and campaign_status filters.
    """
    query = """
        SELECT c.*, l.company_name, l.contact_name, l.email as lead_email,
               l.phone as lead_phone, l.status as lead_status,
               u.full_name as sender_name, u.role as sender_role
        FROM campaigns c
        LEFT JOIN leads l ON c.lead_id = l.id
        LEFT JOIN users u ON c.owner_id = u.id
    """
    params = []
    conditions = []

    if role != "admin":
        conditions.append("c.owner_id = ?")
        params.append(user_id)

    if campaign_type:
        conditions.append("c.campaign_type = ?")
        params.append(campaign_type)

    if campaign_status:
        conditions.append("c.status = ?")
        params.append(campaign_status)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " ORDER BY c.created_at DESC"

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]



async def get_campaign_stats(
    db: aiosqlite.Connection, user_id: int, role: str
) -> dict:
    """
    Get campaign statistics for the dashboard.
    """
    owner_filter = "" if role == "admin" else " WHERE owner_id = ?"
    params = [] if role == "admin" else [user_id]

    # Total campaigns
    cursor = await db.execute(f"SELECT COUNT(*) as count FROM campaigns{owner_filter}", params)
    total = dict(await cursor.fetchone())["count"]

    # Campaigns by type
    type_query = f"""
        SELECT campaign_type, COUNT(*) as count 
        FROM campaigns{owner_filter} 
        GROUP BY campaign_type
    """
    cursor = await db.execute(type_query, params)
    type_rows = await cursor.fetchall()
    by_type = {row["campaign_type"]: row["count"] for row in type_rows}

    # Successful campaigns
    success_filter = " WHERE status = 'sent'" if role == "admin" else " WHERE status = 'sent' AND owner_id = ?"
    success_params = [] if role == "admin" else [user_id]
    cursor = await db.execute(f"SELECT COUNT(*) as count FROM campaigns{success_filter}", success_params)
    sent = dict(await cursor.fetchone())["count"]

    return {
        "total": total,
        "sent": sent,
        "email": by_type.get("email", 0),
        "whatsapp": by_type.get("whatsapp", 0),
        "website": by_type.get("website", 0),
    }


# ──────────────────────────────────────────────
#  Office Hours & Meeting Scheduling Helpers
# ──────────────────────────────────────────────

async def get_office_hours(db: aiosqlite.Connection) -> dict:
    """
    Get office hours and meeting buffer settings from system_settings.
    Returns: { "start_time": "09:00", "end_time": "18:00", "buffer_minutes": 30 }
    """
    settings = {}
    cursor = await db.execute(
        "SELECT key, value FROM system_settings WHERE key IN "
        "('office_start_time', 'office_end_time', 'meeting_buffer_minutes')"
    )
    rows = await cursor.fetchall()
    for row in rows:
        settings[row["key"]] = row["value"]

    return {
        "start_time": settings.get("office_start_time", "09:00"),
        "end_time": settings.get("office_end_time", "18:00"),
        "buffer_minutes": int(settings.get("meeting_buffer_minutes", "30")),
    }


async def update_office_hours(
    db: aiosqlite.Connection,
    start_time: str,
    end_time: str,
    buffer_minutes: int,
):
    """
    Update office hours and meeting buffer in system_settings.
    Creates the keys if they don't exist, otherwise updates them.
    """
    for key, value in [
        ("office_start_time", start_time),
        ("office_end_time", end_time),
        ("meeting_buffer_minutes", str(buffer_minutes)),
    ]:
        await db.execute(
            "INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)",
            (key, value),
        )
    await db.commit()


async def validate_meeting_slot(
    db: aiosqlite.Connection,
    owner_id: int,
    start_datetime: str,
    duration_minutes: int,
    exclude_lead_id: int = None,
) -> dict:
    """
    Validate that a proposed meeting slot is valid for a specific owner.

    Checks (all scoped to THIS owner_id only):
      1. Meeting start and end fall within admin-configured office hours (IST)
      2. No overlap with existing meetings for this owner
      3. 30-min buffer is respected between meetings for this owner

    Args:
        db: Database connection
        owner_id: The salesperson/admin whose schedule to check
        start_datetime: ISO 8601 format e.g. "2026-04-25T10:00:00"
        duration_minutes: Meeting duration in minutes
        exclude_lead_id: If editing, exclude the meeting for this lead from overlap checks

    Returns:
        {"valid": True} or {"valid": False, "reason": "..."}
    """
    from datetime import datetime as dt

    # Parse the proposed meeting start/end
    try:
        new_start = dt.fromisoformat(start_datetime)
    except (ValueError, TypeError):
        return {"valid": False, "reason": "Invalid date/time format."}

    new_end = new_start + timedelta(minutes=duration_minutes)

    # ── 1. Office Hours Check ──
    office = await get_office_hours(db)
    office_start_h, office_start_m = map(int, office["start_time"].split(":"))
    office_end_h, office_end_m = map(int, office["end_time"].split(":"))

    meeting_start_minutes = new_start.hour * 60 + new_start.minute
    meeting_end_minutes = new_end.hour * 60 + new_end.minute
    office_start_minutes = office_start_h * 60 + office_start_m
    office_end_minutes = office_end_h * 60 + office_end_m

    if meeting_start_minutes < office_start_minutes:
        return {
            "valid": False,
            "reason": f"Meeting starts before office hours ({office['start_time']}). "
                      f"Please schedule between {office['start_time']} and {office['end_time']} IST.",
        }
    if meeting_end_minutes > office_end_minutes:
        return {
            "valid": False,
            "reason": f"Meeting ends after office hours ({office['end_time']}). "
                      f"Please schedule between {office['start_time']} and {office['end_time']} IST.",
        }

    # ── 2. Overlap Check (per-user) ──
    # Note: cancelled meetings are deleted from the table, so all rows here are active
    query = """
        SELECT id, lead_id, start_datetime, duration_minutes
        FROM meetings
        WHERE owner_id = ?
    """
    params = [owner_id]

    if exclude_lead_id is not None:
        query += " AND lead_id != ?"
        params.append(exclude_lead_id)

    cursor = await db.execute(query, params)
    existing_meetings = await cursor.fetchall()

    buffer_minutes = office["buffer_minutes"]

    for meeting in existing_meetings:
        ex_start = dt.fromisoformat(meeting["start_datetime"])
        ex_duration = meeting["duration_minutes"] or 60
        ex_end = ex_start + timedelta(minutes=ex_duration)

        # Check direct overlap: new_start < existing_end AND existing_start < new_end
        if new_start < ex_end and ex_start < new_end:
            ex_time_str = ex_start.strftime("%I:%M %p")
            ex_end_str = ex_end.strftime("%I:%M %p")
            return {
                "valid": False,
                "reason": f"Time has been scheduled for another meeting : Sales person is busy from {ex_time_str} to {ex_end_str}. "
                          f"Please choose a different time slot.",
            } 

        # ── 3. Buffer Check (per-user) ──
        # After an existing meeting ends, enforce buffer before next meeting can start
        ex_end_with_buffer = ex_end + timedelta(minutes=buffer_minutes)
        if new_start < ex_end_with_buffer and new_start >= ex_end:
            ex_end_str = ex_end.strftime("%I:%M %p")
            buffer_end_str = ex_end_with_buffer.strftime("%I:%M %p")
            return {
                "valid": False,
                "reason": f"Too close to your previous meeting which ends at {ex_end_str}. "
                          f"A {buffer_minutes}-minute buffer is required between meetings. "
                          f"Please schedule at or after {buffer_end_str}.",
            }

        # Also check buffer the other way: if new meeting ends too close to an existing one's start
        new_end_with_buffer = new_end + timedelta(minutes=buffer_minutes)
        if ex_start < new_end_with_buffer and ex_start >= new_end:
            new_end_str = new_end.strftime("%I:%M %p")
            return {
                "valid": False,
                "reason": f"Your meeting would end at {new_end_str}, but you have another meeting "
                          f"starting at {ex_start.strftime('%I:%M %p')}. A {buffer_minutes}-minute "
                          f"buffer is required between meetings.",
            }

    return {"valid": True}

