"""
Authentication Service — password hashing and JWT token management.
Handles all cryptographic operations for the auth system.
"""

from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
from backend.config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES

# ──────────────────────────────────────────────
#  Password Hashing Context (bcrypt)
# ──────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain_password: str) -> str:
    """
    Hash a plain-text password using bcrypt.
    Returns the hashed string to store in the database.
    """
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a plain-text password against its bcrypt hash.
    Returns True if the password matches.
    """
    return pwd_context.verify(plain_password, hashed_password)


# ──────────────────────────────────────────────
#  JWT Token Operations
# ──────────────────────────────────────────────

def create_access_token(data: dict) -> str:
    """
    Create a signed JWT token with the given payload.
    Adds an expiration claim automatically.
    
    Args:
        data: Dictionary containing claims (e.g., sub, role)
    
    Returns:
        Encoded JWT string
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict | None:
    """
    Decode and validate a JWT token.
    
    Returns:
        Decoded payload dict if valid, None if invalid/expired
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None
