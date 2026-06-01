"""
Lead Service — CRUD operations for the leads table.
Handles lead creation (manual, Excel, OCR), retrieval, update, and deletion.
All queries are scoped to the owner (salesperson) unless user is admin.
"""

import os
import aiosqlite
from datetime import datetime
from backend.config import UPLOAD_DIR


async def create_lead(
    db: aiosqlite.Connection,
    owner_id: int,
    company_name: str = None,
    contact_name: str = None,
    email: str = None,
    phone: str = None,
    source: str = "manual",
    notes: str = None,
) -> dict:
    """
    Create a new lead in the database.
    
    Args:
        db: Active database connection
        owner_id: ID of the user who owns this lead
        company_name: Company name
        contact_name: Contact person name
        email: Contact email
        phone: Contact phone number
        source: 'manual', 'excel', or 'ocr'
        notes: Additional notes
    
    Returns:
        Dictionary with the created lead's data
    """
    # Enforce required email for new leads
    if not email or not email.strip():
        raise ValueError("Email is required to add a lead.")

    # Check for duplicates system-wide (across ALL users)
    conditions = []
    params = []
    if email:
        conditions.append("LOWER(email) = LOWER(?)")
        params.append(email.strip())
    if phone:
        conditions.append("phone = ?")
        params.append(phone.strip())
        
    if conditions:
        dup_query = f"SELECT id FROM leads WHERE {' OR '.join(conditions)}"
        dup_cursor = await db.execute(dup_query, params)
        if await dup_cursor.fetchone():
            raise ValueError("Duplicate lead: A lead with this email or phone already exists in the system.")

    cursor = await db.execute(
        """
        INSERT INTO leads (owner_id, company_name, contact_name, email, phone, source, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (owner_id, company_name, contact_name, email, phone, source, notes),
    )
    await db.commit()
    lead_id = cursor.lastrowid

    return await get_lead_by_id(db, lead_id)


async def get_lead_by_id(db: aiosqlite.Connection, lead_id: int) -> dict | None:
    """Retrieve a single lead by its ID."""
    cursor = await db.execute("SELECT * FROM leads WHERE id = ?", (lead_id,))
    row = await cursor.fetchone()
    return dict(row) if row else None


async def get_leads_for_user(
    db: aiosqlite.Connection,
    user_id: int,
    role: str,
    status: str = None,
    search: str = None,
    source: str = None,
) -> list:
    """
    Retrieve leads filtered by owner.
    Admin sees all leads; salesperson sees only their own.
    
    Args:
        db: Active database connection
        user_id: Current user's numeric ID
        role: User's role ('admin' or 'salesperson')
        status: Optional status filter
        search: Optional search term (matches company_name, contact_name, email, phone)
        source: Optional source filter (e.g., 'Website', 'manual', 'ocr')
    """
    query = "SELECT * FROM leads"
    params = []
    conditions = []

    # Salesperson can only see their own leads
    if role != "admin":
        conditions.append("owner_id = ?")
        params.append(user_id)

    # Optional status filter
    if status:
        conditions.append("status = ?")
        params.append(status)

    # Optional source filter
    if source:
        conditions.append("source = ?")
        params.append(source)

    # Optional search filter
    if search:
        conditions.append(
            "(company_name LIKE ? OR contact_name LIKE ? OR email LIKE ? OR phone LIKE ?)"
        )
        search_term = f"%{search}%"
        params.extend([search_term, search_term, search_term, search_term])

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " ORDER BY created_at DESC"

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def update_lead(
    db: aiosqlite.Connection,
    lead_id: int,
    **fields,
) -> dict | None:
    """
    Update a lead's fields.
    Only provided (non-None) fields are updated.
    """
    # Filter out None values
    updates = {k: v for k, v in fields.items() if v is not None}
    if not updates:
        return await get_lead_by_id(db, lead_id)

    # Check for duplicates system-wide (exclude current lead)
    email = updates.get("email")
    phone = updates.get("phone")
    dup_conditions = []
    dup_params = []
    if email:
        dup_conditions.append("LOWER(email) = LOWER(?)")
        dup_params.append(email.strip())
    if phone:
        dup_conditions.append("phone = ?")
        dup_params.append(phone.strip())

    if dup_conditions:
        dup_query = f"SELECT id FROM leads WHERE ({' OR '.join(dup_conditions)}) AND id != ?"
        dup_params.append(lead_id)
        dup_cursor = await db.execute(dup_query, dup_params)
        if await dup_cursor.fetchone():
            raise ValueError("Duplicate lead: A lead with this email or phone already exists in the system.")

    # Add updated_at timestamp
    updates["updated_at"] = datetime.utcnow().isoformat()

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [lead_id]

    await db.execute(
        f"UPDATE leads SET {set_clause} WHERE id = ?",
        values,
    )
    await db.commit()

    return await get_lead_by_id(db, lead_id)


async def delete_lead(db: aiosqlite.Connection, lead_id: int) -> bool:
    """Delete a lead and its associated data."""
    # Delete associated data first
    await db.execute("DELETE FROM campaigns WHERE lead_id = ?", (lead_id,))
    await db.execute("DELETE FROM meetings WHERE lead_id = ?", (lead_id,))
    await db.execute("DELETE FROM website_leads WHERE lead_id = ?", (lead_id,))
    cursor = await db.execute("DELETE FROM leads WHERE id = ?", (lead_id,))
    await db.commit()
    return cursor.rowcount > 0


async def bulk_delete_leads(
    db: aiosqlite.Connection, lead_ids: list, user_id: int, role: str
) -> int:
    """
    Delete multiple leads and all associated data in a single transaction.
    Uses bulk SQL (WHERE id IN (...)) for maximum speed.

    Args:
        db: Active database connection
        lead_ids: List of lead IDs to delete
        user_id: Current user's numeric ID
        role: User's role ('admin' or 'salesperson')

    Returns:
        Number of leads actually deleted
    """
    if not lead_ids:
        return 0

    placeholders = ",".join("?" * len(lead_ids))

    # Build ownership filter for non-admin users
    if role != "admin":
        owner_check = " AND owner_id = ?"
        lead_params = list(lead_ids) + [user_id]
    else:
        owner_check = ""
        lead_params = list(lead_ids)

    # Get the actual IDs that will be deleted (respecting ownership)
    cursor = await db.execute(
        f"SELECT id FROM leads WHERE id IN ({placeholders}){owner_check}",
        lead_params,
    )
    valid_ids = [row["id"] for row in await cursor.fetchall()]

    if not valid_ids:
        return 0

    vp = ",".join("?" * len(valid_ids))

    # Bulk delete all associated records in one transaction
    await db.execute(f"DELETE FROM campaigns WHERE lead_id IN ({vp})", valid_ids)
    await db.execute(f"DELETE FROM meetings WHERE lead_id IN ({vp})", valid_ids)
    await db.execute(f"DELETE FROM website_leads WHERE lead_id IN ({vp})", valid_ids)

    # Bulk delete the leads themselves
    cursor = await db.execute(f"DELETE FROM leads WHERE id IN ({vp})", valid_ids)
    await db.commit()

    return cursor.rowcount


async def delete_all_leads(db: aiosqlite.Connection, user_id: int, role: str) -> int:
    """Delete all leads and their associated data for the current user."""
    if role == "admin":
        await db.execute("DELETE FROM website_leads")
        await db.execute("DELETE FROM meetings")
        await db.execute("DELETE FROM campaigns")
        cursor = await db.execute("DELETE FROM leads")
    else:
        await db.execute("DELETE FROM website_leads WHERE lead_id IN (SELECT id FROM leads WHERE owner_id = ?)", (user_id,))
        await db.execute("DELETE FROM meetings WHERE owner_id = ?", (user_id,))
        await db.execute("DELETE FROM campaigns WHERE lead_id IN (SELECT id FROM leads WHERE owner_id = ?)", (user_id,))
        cursor = await db.execute("DELETE FROM leads WHERE owner_id = ?", (user_id,))
    
    await db.commit()
    return cursor.rowcount


async def get_lead_stats(
    db: aiosqlite.Connection, user_id: int, role: str
) -> dict:
    """
    Get lead statistics for the dashboard.
    Admin sees all stats; salesperson sees only their own.
    """
    owner_filter = "" if role == "admin" else " WHERE owner_id = ?"
    params = [] if role == "admin" else [user_id]

    # Total leads
    cursor = await db.execute(f"SELECT COUNT(*) as count FROM leads{owner_filter}", params)
    total = dict(await cursor.fetchone())["count"]

    # Leads by status
    status_query = f"""
        SELECT status, COUNT(*) as count 
        FROM leads{owner_filter} 
        GROUP BY status
    """
    cursor = await db.execute(status_query, params)
    status_rows = await cursor.fetchall()
    by_status = {row["status"]: row["count"] for row in status_rows}

    return {
        "total": total,
        "new": by_status.get("new", 0),
        "contacted": by_status.get("contacted", 0),
        "approved": by_status.get("won", 0),
        "lost": by_status.get("lost", 0),
    }


def ensure_user_upload_dir(user_id: int) -> str:
    """
    Create and return the user-specific upload directory path.
    """
    user_dir = os.path.join(UPLOAD_DIR, f"user_{user_id}")
    os.makedirs(user_dir, exist_ok=True)
    return user_dir


async def generate_booking_token(db: aiosqlite.Connection, lead_id: int) -> str:
    """
    Generate a unique UUID4 booking token for a lead and store it.
    If the lead already has a valid (unused) token, return it.
    
    Args:
        db: Active database connection
        lead_id: ID of the lead
    
    Returns:
        The booking token string
    """
    import uuid

    # Check if lead already has an unused token
    cursor = await db.execute(
        "SELECT booking_token, booking_token_used FROM leads WHERE id = ?",
        (lead_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise ValueError(f"Lead with id {lead_id} not found")

    # If there's already a valid unused token, return it
    if row["booking_token"] and not row["booking_token_used"]:
        return row["booking_token"]

    # Generate a new token
    token = str(uuid.uuid4())
    await db.execute(
        "UPDATE leads SET booking_token = ?, booking_token_used = 0 WHERE id = ?",
        (token, lead_id),
    )
    await db.commit()
    return token


async def get_booking_token(db: aiosqlite.Connection, lead_id: int) -> dict:
    """
    Get the existing booking token for a lead, or generate one if missing.
    
    Returns:
        dict with 'token' and 'used' status
    """
    cursor = await db.execute(
        "SELECT booking_token, booking_token_used FROM leads WHERE id = ?",
        (lead_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise ValueError(f"Lead with id {lead_id} not found")

    token = row["booking_token"]
    used = row["booking_token_used"]

    if not token:
        token = await generate_booking_token(db, lead_id)
        used = 0

    return {"token": token, "used": bool(used)}

