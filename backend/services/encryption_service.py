"""
Encryption Service — Provide symmetric encryption for sensitive configuration data.
Generates and stores a master SECRET_KEY in the .env file.
"""

import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv, set_key

# Ensure .env is loaded
load_dotenv()

ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")

def get_or_create_key() -> bytes:
    """Retrieve the master encryption key from .env or create a new one."""
    key = os.getenv("SECRET_KEY")
    if not key:
        # Generate new key
        key = Fernet.generate_key().decode()
        # Make sure .env exists
        if not os.path.exists(ENV_PATH):
            open(ENV_PATH, 'a').close()
        set_key(ENV_PATH, "SECRET_KEY", key)
        # Reload environment
        load_dotenv()
    return key.encode()

# Initialize Fernet cipher suite
try:
    _cipher_suite = Fernet(get_or_create_key())
except Exception as e:
    print(f"Warning: Failed to initialize encryption suite: {e}")
    _cipher_suite = None

def encrypt_text(plaintext: str) -> str:
    """Encrypt a plaintext string."""
    if not plaintext:
        return ""
    if not _cipher_suite:
        return plaintext
    try:
        return _cipher_suite.encrypt(plaintext.encode()).decode()
    except Exception:
        return plaintext

def decrypt_text(ciphertext: str) -> str:
    """Decrypt a ciphertext string. Returns plaintext if it is not encrypted."""
    if not ciphertext:
        return ""
    if not _cipher_suite:
        return ciphertext
    try:
        return _cipher_suite.decrypt(ciphertext.encode()).decode()
    except Exception:
        # If decryption fails (e.g., it was just stored in plaintext), return as is
        return ciphertext
