"""
Campaign Pydantic models — request/response schemas for campaigns.
Placeholder for Phase 4 implementation.
"""

from pydantic import BaseModel
from typing import Optional, List


class CampaignCreate(BaseModel):
    """Schema for creating a new campaign."""
    lead_id: int
    campaign_type: str  # 'email', 'whatsapp', or 'website'
    subject: Optional[str] = None
    message: str
    is_html: Optional[bool] = False   # If True, email body is rendered as HTML
    cc_emails: Optional[List[str]] = None  # Optional CC email addresses
    include_booking: Optional[bool] = True  # If True, append "Book Appointment" button to email


class CampaignResponse(BaseModel):
    """Schema for returning campaign data."""
    id: int
    lead_id: int
    owner_id: int
    campaign_type: str
    subject: Optional[str] = None
    message: str
    status: str
    sent_at: Optional[str] = None
    error_message: Optional[str] = None
    created_at: Optional[str] = None
