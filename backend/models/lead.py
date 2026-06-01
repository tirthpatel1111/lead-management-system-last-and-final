"""
Lead Pydantic models — request/response schemas for lead management.
Placeholder for Phase 2 implementation.
"""

from pydantic import BaseModel, field_validator
from typing import Optional

from backend.validators import validate_email, validate_phone


class LeadCreate(BaseModel):
    """Schema for creating a new lead. Email is required, phone is optional."""
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    email: str
    phone: Optional[str] = None
    source: str = "manual"
    notes: Optional[str] = None

    @field_validator('email')
    @classmethod
    def check_email(cls, v):
        return validate_email(v)

    @field_validator('phone')
    @classmethod
    def check_phone(cls, v):
        return validate_phone(v)


class LeadResponse(BaseModel):
    """Schema for returning lead data."""
    id: int
    owner_id: int
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    source: str
    notes: Optional[str] = None
    status: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class LeadUpdate(BaseModel):
    """Schema for updating a lead."""
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None

    @field_validator('email')
    @classmethod
    def check_email(cls, v):
        return validate_email(v)

    @field_validator('phone')
    @classmethod
    def check_phone(cls, v):
        return validate_phone(v)
