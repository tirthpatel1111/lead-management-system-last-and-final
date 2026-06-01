"""
Shared validation helpers for email and phone fields.
Used across Pydantic models and route handlers for consistent validation.
"""

import re

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$')
PHONE_REGEX = re.compile(r'^(\d{10}|\+91\d{10}|\+91\s\d{10})$')


def validate_email(email: str | None) -> str | None:
    """
    Validate and return cleaned email, or raise ValueError.
    
    Accepts standard email format: user@domain.tld
    Allows Gmail, Outlook, company domains, etc.
    Returns None if input is empty/None (field is optional).
    """
    if not email or not email.strip():
        return None
    email = email.strip()
    if not EMAIL_REGEX.match(email):
        raise ValueError(f"Invalid email format: '{email}'. Please enter a valid email address (e.g., john@company.com)")
    return email


def validate_phone(phone: str | None) -> str | None:
    """
    Validate and return cleaned phone, or raise ValueError.
    
    Accepted formats:
      - 1234567890      (10 digits)
      - +911234567890   (+91 prefix, 13 chars)
      - +91 1234567890  (+91 space prefix, 14 chars)
    
    Returns None if input is empty/None (field is optional).
    """
    if not phone or not phone.strip():
        return None
    phone = phone.strip()
    if not PHONE_REGEX.match(phone):
        raise ValueError(
            f"Invalid phone format: '{phone}'. "
            "Accepted formats: 1234567890, +911234567890, or +91 1234567890"
        )
    return phone
