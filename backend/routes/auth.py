"""
Authentication Routes — login and current-user endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status
import aiosqlite

from backend.database import get_db
from backend.models.user import UserLogin, UserCreate, UserEmailUpdate, UserResponse, TokenResponse
from backend.services.auth_service import verify_password, create_access_token
from backend.services.user_service import get_user_by_user_id, get_user_by_id, create_user, get_all_users, update_user_email, delete_user
from backend.middleware.auth_middleware import get_current_user, require_admin

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/login", response_model=TokenResponse)
async def login(credentials: UserLogin, db: aiosqlite.Connection = Depends(get_db)):
    """
    Authenticate a user with user_id and password.
    Returns a JWT access token on success.
    """
    # Look up user by username
    user = await get_user_by_user_id(db, credentials.user_id)

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    # Verify password against stored hash
    if not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    # Check if account is active
    if not user.get("is_active", 1):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated. Contact admin.",
        )

    # Create JWT token with user_id and role in payload
    token = create_access_token({"sub": user["user_id"], "role": user["role"]})

    return TokenResponse(
        access_token=token,
        user=UserResponse(
            id=user["id"],
            user_id=user["user_id"],
            full_name=user["full_name"],
            role=user["role"],
            email=user["email"],
            is_active=user["is_active"],
            created_at=str(user["created_at"]) if user["created_at"] else None,
        ),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    """
    Return the currently authenticated user's info.
    Used by the frontend to hydrate the dashboard.
    """
    return UserResponse(
        id=current_user["id"],
        user_id=current_user["user_id"],
        full_name=current_user["full_name"],
        role=current_user["role"],
        email=current_user["email"],
        is_active=current_user["is_active"],
        created_at=str(current_user["created_at"]) if current_user["created_at"] else None,
    )


@router.post("/users", response_model=UserResponse)
async def create_new_user(
    user_data: UserCreate,
    db: aiosqlite.Connection = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """
    Create a new user account. Admin only.
    """
    # Check if user_id already exists
    existing = await get_user_by_user_id(db, user_data.user_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Username '{user_data.user_id}' already exists",
        )

    # Validate role
    if user_data.role not in ("admin", "salesperson"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be 'admin' or 'salesperson'",
        )

    user = await create_user(
        db=db,
        user_id=user_data.user_id,
        password=user_data.password,
        full_name=user_data.full_name,
        role=user_data.role,
        email=user_data.email,
    )

    return UserResponse(
        id=user["id"],
        user_id=user["user_id"],
        full_name=user["full_name"],
        role=user["role"],
        email=user["email"],
        is_active=user["is_active"],
        created_at=str(user["created_at"]) if user["created_at"] else None,
    )


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    db: aiosqlite.Connection = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """
    List all users. Admin only.
    """
    users = await get_all_users(db)
    return [
        UserResponse(
            id=u["id"],
            user_id=u["user_id"],
            full_name=u["full_name"],
            role=u["role"],
            email=u["email"],
            is_active=u["is_active"],
            created_at=str(u["created_at"]) if u["created_at"] else None,
        )
        for u in users
    ]


@router.put("/users/{user_id}/email", response_model=UserResponse)
async def update_user_email_route(
    user_id: int,
    payload: UserEmailUpdate,
    db: aiosqlite.Connection = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """
    Update a user's email address. Admin only.
    """
    email = payload.email.strip()
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email cannot be empty",
        )

    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    updated = await update_user_email(db, user_id, email)
    return UserResponse(
        id=updated["id"],
        user_id=updated["user_id"],
        full_name=updated["full_name"],
        role=updated["role"],
        email=updated["email"],
        is_active=updated["is_active"],
        created_at=str(updated["created_at"]) if updated["created_at"] else None,
    )


@router.delete("/users/{user_id}")
async def delete_existing_user(
    user_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Delete a user by their numeric ID.
    Rules:
    - Any authenticated user can delete their own account.
    - Admins can delete any user (salesperson or another admin).
    - Non-admins can ONLY delete their own account.
    - The last remaining admin in the system CANNOT be deleted
      (would leave system with no admin to manage users).
    - Deleting a user cascade-deletes all their leads, campaigns, and meetings.
    """
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Non-admins may only delete themselves
    if current_user["role"] != "admin" and user["id"] != current_user["id"]:
        raise HTTPException(
            status_code=403,
            detail="Access denied: you can only delete your own account",
        )

    # If the account being deleted is an admin, ensure at least 1 admin remains
    if user["role"] == "admin":
        cursor = await db.execute(
            "SELECT COUNT(*) as count FROM users WHERE role = 'admin'"
        )
        row = await cursor.fetchone()
        if dict(row)["count"] <= 1:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Cannot delete the last admin account. "
                    "Create another admin first, then delete this one."
                ),
            )

    await delete_user(db, user_id)
    return {"message": "User and all associated data deleted successfully"}

