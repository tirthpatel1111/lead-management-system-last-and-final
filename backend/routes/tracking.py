"""
Tracking Routes — Email open tracking via 1x1 tracking pixel.
When an email client loads the tracking pixel, we record the open event
and serve a tiny transparent image.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import Response
import aiosqlite
from datetime import datetime, timezone, timedelta

from backend.database import get_db

# IST timezone offset (UTC+5:30)
IST = timezone(timedelta(hours=5, minutes=30))

# Minimal 1x1 transparent PNG (standard email tracking pixel)
_TRACKING_PIXEL = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)

router = APIRouter(prefix="/api/track", tags=["Tracking"])


@router.get("/open/{campaign_id}")
async def track_email_open(
    campaign_id: int,
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Track email open event via tracking pixel.
    Public endpoint — no auth required (email clients make the request).

    - Looks up the campaign by ID
    - If found and not already marked opened, sets email_opened=1 and opened_at
    - Always serves a tiny 1x1 transparent PNG (standard tracking pixel)
    - Idempotent: subsequent requests don't overwrite the first open timestamp
    """
    try:
        # Check if campaign exists and hasn't been opened yet
        cursor = await db.execute(
            "SELECT id, email_opened FROM campaigns WHERE id = ?",
            (campaign_id,),
        )
        row = await cursor.fetchone()

        if row and not row["email_opened"]:
            # First open — record the timestamp
            opened_at = datetime.now(IST).isoformat()
            await db.execute(
                "UPDATE campaigns SET email_opened = 1, opened_at = ? WHERE id = ?",
                (opened_at, campaign_id),
            )
            await db.commit()
    except Exception as e:
        # Never fail — always serve the pixel
        print(f"[TRACKING] Error recording open for campaign {campaign_id}: {e}")

    # Serve the 1x1 transparent tracking pixel
    return Response(
        content=_TRACKING_PIXEL,
        media_type="image/png",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )

