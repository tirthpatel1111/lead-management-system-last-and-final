"""
User Service — CRUD operations for the users table.
Handles user creation, retrieval, and admin seeding.
"""

import aiosqlite
from backend.services.auth_service import hash_password
from backend.config import (
    DEFAULT_ADMIN_USER_ID,
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_NAME,
    DEFAULT_ADMIN_EMAIL,
)


async def create_user(
    db: aiosqlite.Connection,
    user_id: str,
    password: str,
    full_name: str,
    role: str = "salesperson",
    email: str = None,
) -> dict:
    """
    Create a new user in the database.
    
    Args:
        db: Active database connection
        user_id: Unique login username
        password: Plain-text password (will be hashed)
        full_name: User's display name
        role: 'admin' or 'salesperson'
        email: Optional email address
    
    Returns:
        Dictionary with the created user's data
    """
    password_hash = hash_password(password)
    cursor = await db.execute(
        """
        INSERT INTO users (user_id, password_hash, full_name, role, email)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user_id, password_hash, full_name, role, email),
    )
    await db.commit()

    # Fetch and return the created user
    user = await get_user_by_user_id(db, user_id)
    return user


async def get_user_by_user_id(db: aiosqlite.Connection, user_id: str) -> dict | None:
    """
    Retrieve a user by their login username (user_id).
    Returns None if not found.
    """
    cursor = await db.execute(
        "SELECT * FROM users WHERE user_id = ?", (user_id,)
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    # Convert sqlite3.Row to dict
    return dict(row)


async def get_user_by_id(db: aiosqlite.Connection, id: int) -> dict | None:
    """
    Retrieve a user by their numeric primary key (id).
    Returns None if not found.
    """
    cursor = await db.execute(
        "SELECT * FROM users WHERE id = ?", (id,)
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    return dict(row)


async def get_all_users(db: aiosqlite.Connection) -> list:
    """
    Retrieve all users from the database.
    Used by Admin for user management.
    """
    cursor = await db.execute(
        "SELECT id, user_id, full_name, role, email, is_active, created_at FROM users"
    )
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def update_user_email(db: aiosqlite.Connection, user_id: int, email: str) -> dict | None:
    """
    Update a user's email address by their numeric primary key (id).
    Returns the updated user dict, or None if user not found.
    """
    await db.execute(
        "UPDATE users SET email = ? WHERE id = ?",
        (email, user_id),
    )
    await db.commit()
    return await get_user_by_id(db, user_id)


async def delete_user(db: aiosqlite.Connection, user_id_to_delete: int) -> bool:
    """
    Delete a user and cascade-delete ALL their associated data.
    Order: meetings → campaigns → leads → user (respects FK dependencies).
    """
    await db.execute("DELETE FROM website_leads WHERE lead_id IN (SELECT id FROM leads WHERE owner_id = ?)", (user_id_to_delete,))
    await db.execute("DELETE FROM meetings WHERE owner_id = ?", (user_id_to_delete,))
    await db.execute("DELETE FROM campaigns WHERE owner_id = ?", (user_id_to_delete,))
    await db.execute("DELETE FROM leads WHERE owner_id = ?", (user_id_to_delete,))
    cursor = await db.execute("DELETE FROM users WHERE id = ?", (user_id_to_delete,))
    await db.commit()
    return cursor.rowcount > 0


async def seed_admin(db: aiosqlite.Connection):
    """
    Create the default admin account if no admin exists.
    Called on application startup to ensure there's always
    at least one admin who can log in.
    """
    # Check if any admin already exists
    cursor = await db.execute(
        "SELECT COUNT(*) as count FROM users WHERE role = 'admin'"
    )
    row = await cursor.fetchone()

    if dict(row)["count"] == 0:
        await create_user(
            db=db,
            user_id=DEFAULT_ADMIN_USER_ID,
            password=DEFAULT_ADMIN_PASSWORD,
            full_name=DEFAULT_ADMIN_NAME,
            role="admin",
            email=DEFAULT_ADMIN_EMAIL,
        )
        print("=" * 50)
        print("[!] DEFAULT ADMIN ACCOUNT CREATED")
        print(f"   Username: {DEFAULT_ADMIN_USER_ID}")
        print(f"   Password: {DEFAULT_ADMIN_PASSWORD}")
        print("   WARNING: Change this password after first login!")
        print("=" * 50)
    else:
        print("[OK] Admin account already exists. Skipping seed.")
