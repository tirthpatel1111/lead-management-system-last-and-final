"""
User Pydantic models — request/response schemas for authentication.
"""

from pydantic import BaseModel, field_validator
from typing import Optional

from backend.validators import validate_email


class UserLogin(BaseModel):
    """Schema for login request body."""
    user_id: str
    password: str


class UserCreate(BaseModel):
    """Schema for creating a new user (Admin only)."""
    user_id: str
    password: str
    full_name: str
    role: str = "salesperson"  # default role
    email: str  # Required — used as meeting attendee for salesperson

    @field_validator('email')
    @classmethod
    def check_email(cls, v):
        result = validate_email(v)
        if not result:
            raise ValueError("Email is required")
        return result


class UserEmailUpdate(BaseModel):
    """Schema for updating a user's email address (Admin only)."""
    email: str

    @field_validator('email')
    @classmethod
    def check_email(cls, v):
        result = validate_email(v)
        if not result:
            raise ValueError("Email is required")
        return result


class UserResponse(BaseModel):
    """Schema for returning user info (never includes password)."""
    id: int
    user_id: str
    full_name: str
    role: str
    email: Optional[str] = None
    is_active: int = 1
    created_at: Optional[str] = None


class TokenResponse(BaseModel):
    """Schema for login response with JWT token."""
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
