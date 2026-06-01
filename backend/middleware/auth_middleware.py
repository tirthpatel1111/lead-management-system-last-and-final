"""
Authentication Middleware — FastAPI dependencies for JWT verification
and role-based access control.

Usage in routes:
    @router.get("/protected")
    async def protected_route(user = Depends(get_current_user)):
        ...

    @router.get("/admin-only")
    async def admin_route(user = Depends(require_admin)):
        ...
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.services.auth_service import decode_token
from backend.services.user_service import get_user_by_user_id
from backend.database import get_db
import aiosqlite

# HTTPBearer extracts the token from "Authorization: Bearer <token>" header
security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict:
    """
    FastAPI dependency that validates the JWT token and returns the
    current user's data from the database.

    Raises 401 if:
      - Token is missing or malformed
      - Token is expired
      - User doesn't exist in the database
      - User account is deactivated
    """
    token = credentials.credentials

    # Decode the JWT token
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Extract username from token payload
    user_id: str = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    # Fetch user from database
    user = await get_user_by_user_id(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    # Check if account is active
    if not user.get("is_active", 1):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """
    FastAPI dependency that ensures the current user has the 'admin' role.
    Must be used after get_current_user.

    Raises 403 if the user is not an admin.
    """
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
