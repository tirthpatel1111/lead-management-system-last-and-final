from fastapi import APIRouter, Depends, HTTPException
import aiosqlite
import json

from backend.database import get_db
from backend.middleware.auth_middleware import get_current_user

router = APIRouter(prefix="/api/website-leads", tags=["Website Leads"])

@router.get("")
async def list_website_leads(
    category: str = None,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    List website leads. Salesperson sees own; Admin sees all.
    Optionally filter by category (POSH or Contact Us).
    """
    query = "SELECT wl.*, l.owner_id FROM website_leads wl JOIN leads l ON wl.lead_id = l.id"
    params = []
    conditions = []

    if current_user["role"] != "admin":
        conditions.append("l.owner_id = ?")
        params.append(current_user["id"])

    if category:
        conditions.append("wl.category = ?")
        params.append(category)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " ORDER BY wl.created_at DESC"

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    
    results = []
    for row in rows:
        lead_data = dict(row)
        full_data = json.loads(lead_data["full_data"])
        lead_data["full_data"] = full_data
        results.append(lead_data)
        
    return results
