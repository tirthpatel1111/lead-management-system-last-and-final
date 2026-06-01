"""
Dashboard Routes — Aggregated statistics for the dashboard page.
Combines lead and campaign stats into a single API call.
"""

from fastapi import APIRouter, Depends
import aiosqlite

from backend.database import get_db
from backend.middleware.auth_middleware import get_current_user
from backend.services.lead_service import get_lead_stats
from backend.services.campaign_service import get_campaign_stats

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/stats")
async def dashboard_stats(
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Get aggregated dashboard statistics.
    Returns lead counts, campaign counts, and user info.
    """
    lead_stats = await get_lead_stats(db, current_user["id"], current_user["role"])
    campaign_stats_data = await get_campaign_stats(db, current_user["id"], current_user["role"])

    return {
        "user": {
            "id": current_user["id"],
            "full_name": current_user["full_name"],
            "role": current_user["role"],
        },
        "leads": lead_stats,
        "campaigns": campaign_stats_data,
    }
