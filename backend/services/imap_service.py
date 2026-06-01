"""
IMAP Service — Fetch emails, parse leads via LLM, and assign using round-robin.
"""

import os
import urllib.request
import urllib.error
import urllib.parse
import base64
import json
import asyncio
from dotenv import load_dotenv, set_key

from backend.services.encryption_service import encrypt_text, decrypt_text

# Load environment variables
load_dotenv()
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")

# ──────────────────────────────────────────────
#  Gmail Fetch Configuration
# ──────────────────────────────────────────────
GMAIL_FETCH_CONFIG = {
    "client_id": os.getenv("GMAIL_FETCH_CLIENT_ID", ""),
    "client_secret": os.getenv("GMAIL_FETCH_CLIENT_SECRET", ""),
    "refresh_token": os.getenv("GMAIL_FETCH_REFRESH_TOKEN", ""),
    "email": os.getenv("GMAIL_FETCH_EMAIL", ""),
}

def is_gmail_fetch_configured() -> bool:
    """Check if Gmail fetch settings are configured."""
    return bool(GMAIL_FETCH_CONFIG["client_id"] and GMAIL_FETCH_CONFIG["client_secret"] and GMAIL_FETCH_CONFIG["refresh_token"])

def update_gmail_fetch_config(config: dict):
    """
    Update Gmail Fetch configuration at runtime and persist to .env.
    """
    if not os.path.exists(ENV_PATH):
        open(ENV_PATH, 'a').close()

    for key, val in config.items():
        if key in GMAIL_FETCH_CONFIG:
            if key in ["client_secret", "refresh_token"] and val == "***":
                continue
            
            GMAIL_FETCH_CONFIG[key] = val
            env_key = f"GMAIL_FETCH_{key.upper()}"
            set_key(ENV_PATH, env_key, str(val))

# ──────────────────────────────────────────────
#  Email Processing Logic
# ──────────────────────────────────────────────
import traceback
import re
import aiosqlite
from groq import Groq

from backend.config import DB_PATH
from backend.services.lead_service import create_lead
from backend.services.email_service import send_email
from backend.default_templates import POSH_DEFAULT_TEMPLATE, CONTACT_US_DEFAULT_TEMPLATE

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

async def get_next_salesperson(db: aiosqlite.Connection) -> int | None:
    """
    Round-robin logic to find the next active salesperson.
    """
    # 1. Get all active salespersons ordered by ID
    cursor = await db.execute("SELECT id FROM users WHERE role = 'salesperson' AND is_active = 1 ORDER BY id ASC")
    rows = await cursor.fetchall()
    active_salespersons = [row["id"] for row in rows]

    if not active_salespersons:
        # If no salespersons, assign to an admin
        cursor = await db.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id ASC LIMIT 1")
        admin = await cursor.fetchone()
        return admin["id"] if admin else None

    # 2. Get last assigned user ID from system_settings
    cursor = await db.execute("SELECT value FROM system_settings WHERE key = 'last_assigned_salesperson_id'")
    row = await cursor.fetchone()
    last_id = int(row["value"]) if row else None

    # 3. Determine next user
    next_id = active_salespersons[0] # Default to first
    if last_id is not None and last_id in active_salespersons:
        idx = active_salespersons.index(last_id)
        if idx + 1 < len(active_salespersons):
            next_id = active_salespersons[idx + 1]

    # 4. Save the new last_assigned_salesperson_id
    await db.execute(
        "INSERT OR REPLACE INTO system_settings (key, value) VALUES ('last_assigned_salesperson_id', ?)",
        (str(next_id),)
    )
    await db.commit()

    return next_id

def extract_lead_data_via_llm(email_body: str, subject: str) -> dict:
    """
    Use Groq LLM to extract lead data from the email body.
    Handles variable formats cleanly based on category (POSH vs Contact Us).
    """
    if not GROQ_API_KEY:
        print("[IMAP] GROQ_API_KEY missing, cannot extract data.")
        return {}
        
    client = Groq(api_key=GROQ_API_KEY)
    
    is_posh = "posh" in subject.lower()
    
    if is_posh:
        fields = """
        - Name (or contact_person)
        - Phone
        - Email ID
        - Company Name
        - City
        - Services Interested In
        - POSH interest (e.g. Yes/No to the 15,000 cost question)
        - Training Mode
        - Number of Employees
        - Preferred Timeline
        - Requirement Message
        """
    else:
        fields = """
        - Name (or contact_person)
        - Phone
        - Email ID
        - Company Name
        - City
        - Website
        - Turnover
        - Employee Size
        - Requirement Message
        """

    prompt = f"""
    You are an information extraction system.
    Extract ONLY the following fields from the given email body about a new lead:
    {fields}
    
    Rules:
    - Return STRICT JSON only.
    - Use snake_case for the JSON keys (e.g., "name", "phone", "email_id", "company_name", "turnover", etc.).
    - Ensure 'name' and 'company_name' and 'phone' and 'email_id' are present.
    - If a field is missing, return null.
    - Do not include any explanations or markdown formatting outside the JSON block.
    
    Email Body:
    \"\"\"
    {email_body[:4000]}  # limit text length for safety
    \"\"\"
    """
    
    try:
        response = client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=300,
        )
        content = response.choices[0].message.content
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            return json.loads(match.group(0))
    except Exception as e:
        print(f"[IMAP] Groq LLM Error: {e}")
        
    return {}

def _get_fetch_access_token() -> str:
    """
    Exchange the stored refresh token for a short-lived access token.
    Uses Google's OAuth2 token endpoint directly.
    """
    # Reload config to ensure we have the latest from .env
    load_dotenv(dotenv_path=ENV_PATH, override=True)
    GMAIL_FETCH_CONFIG["client_id"] = os.getenv("GMAIL_FETCH_CLIENT_ID", GMAIL_FETCH_CONFIG["client_id"])
    GMAIL_FETCH_CONFIG["client_secret"] = os.getenv("GMAIL_FETCH_CLIENT_SECRET", GMAIL_FETCH_CONFIG["client_secret"])
    GMAIL_FETCH_CONFIG["refresh_token"] = os.getenv("GMAIL_FETCH_REFRESH_TOKEN", GMAIL_FETCH_CONFIG["refresh_token"])
    GMAIL_FETCH_CONFIG["email"] = os.getenv("GMAIL_FETCH_EMAIL", GMAIL_FETCH_CONFIG["email"])

    post_data = urllib.parse.urlencode({
        "client_id": GMAIL_FETCH_CONFIG["client_id"],
        "client_secret": GMAIL_FETCH_CONFIG["client_secret"],
        "refresh_token": GMAIL_FETCH_CONFIG["refresh_token"],
        "grant_type": "refresh_token",
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=post_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result["access_token"]
    except Exception as e:
        print(f"[GMAIL FETCH] Failed to get access token: {e}")
        return ""

def fetch_emails_sync():
    """Synchronous function to connect and fetch emails via Gmail API. Ran in a separate thread."""
    if not is_gmail_fetch_configured():
        return []
        
    access_token = _get_fetch_access_token()
    if not access_token:
        return []

    try:
        # Search for UNREAD messages with "Website Lead" in subject
        query = urllib.parse.quote('is:unread subject:"Website Lead"')
        url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages?q={query}"
        
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
            method="GET",
        )
        
        with urllib.request.urlopen(req, timeout=15) as resp:
            search_data = json.loads(resp.read().decode("utf-8"))
            
        messages = search_data.get("messages", [])
        if not messages:
            return []
            
        processed_data = []
        
        for msg in messages:
            msg_id = msg["id"]
            
            # Fetch message parts
            msg_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}?format=full"
            msg_req = urllib.request.Request(
                msg_url,
                headers={"Authorization": f"Bearer {access_token}"},
                method="GET",
            )
            
            with urllib.request.urlopen(msg_req, timeout=15) as msg_resp:
                msg_data = json.loads(msg_resp.read().decode("utf-8"))
                
            headers = msg_data.get("payload", {}).get("headers", [])
            subject = ""
            for header in headers:
                if header["name"].lower() == "subject":
                    subject = header["value"]
                    break
                    
            if "website lead" in subject.lower():
                # Extract body
                body_content = ""
                payload = msg_data.get("payload", {})
                
                # Helper to extract body from parts
                def extract_body(part):
                    if part.get("mimeType") in ["text/plain", "text/html"] and "data" in part.get("body", {}):
                        return base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="ignore")
                    if "parts" in part:
                        for subpart in part["parts"]:
                            result = extract_body(subpart)
                            if result:
                                return result
                    return ""
                
                body_content = extract_body(payload)
                if not body_content and "data" in payload.get("body", {}):
                    body_content = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="ignore")
                    
                processed_data.append({
                    "subject": subject,
                    "body": body_content
                })
                
                # Mark as Read (remove UNREAD label)
                modify_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}/modify"
                modify_data = json.dumps({"removeLabelIds": ["UNREAD"]}).encode("utf-8")
                modify_req = urllib.request.Request(
                    modify_url,
                    data=modify_data,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json"
                    },
                    method="POST",
                )
                try:
                    urllib.request.urlopen(modify_req, timeout=10)
                except Exception as e:
                    print(f"[GMAIL FETCH] Error marking message {msg_id} as read: {e}")
                    
        return processed_data
    except Exception as e:
        print(f"[GMAIL FETCH] Fetch Error: {e}")
        traceback.print_exc()
        return []

async def process_incoming_emails():
    """Background task to fetch and process emails."""
    if not is_gmail_fetch_configured():
        return
        
    # Fetch emails off main thread
    emails_to_process = await asyncio.to_thread(fetch_emails_sync)
    
    if not emails_to_process:
        return
        
    print(f"[GMAIL FETCH] Found {len(emails_to_process)} 'Website Lead' emails. Processing...")
    
    # Process and add to DB
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        db.row_factory = aiosqlite.Row
        
        for email_data in emails_to_process:
            # 1. Extract JSON via LLM
            extracted = extract_lead_data_via_llm(email_data["body"], email_data["subject"])
            
            # 2. Get round-robin assignment
            owner_id = await get_next_salesperson(db)
            if not owner_id:
                print("[GMAIL FETCH] Warning: No active salespersons or admins available to assign lead.")
                continue
                
            # 3. Create lead
            company_name = extracted.get("company_name") or extracted.get("company")
            contact_name = extracted.get("name") or extracted.get("contact_person")
            email_addr = extracted.get("email_id") or extracted.get("email")
            phone = extracted.get("phone")
            
            try:
                lead = await create_lead(
                    db=db,
                    owner_id=owner_id,
                    company_name=company_name,
                    contact_name=contact_name,
                    email=email_addr,
                    phone=str(phone).strip() if phone else None,
                    source="Website",
                    notes=f"Auto-imported from email subject: {email_data['subject']}"
                )
                
                # 4. Insert into website_leads table
                category = "POSH" if "posh" in email_data["subject"].lower() else "Contact Us"
                await db.execute(
                    "INSERT INTO website_leads (lead_id, category, full_data) VALUES (?, ?, ?)",
                    (lead["id"], category, json.dumps(extracted))
                )
                await db.commit()
                
                # 4b. Auto-create "website" campaign entry for Campaigns page visibility
                await db.execute(
                    """INSERT INTO campaigns (lead_id, owner_id, campaign_type, subject, message, status)
                       VALUES (?, ?, 'website', ?, ?, 'website')""",
                    (
                        lead["id"],
                        owner_id,
                        f"Website Lead - {category}",
                        f"Auto-imported {category} lead from website form",
                    )
                )
                await db.commit()
                
                print(f"[GMAIL FETCH] Successfully created Website lead assigned to User #{owner_id}")
                
                # 5. Send automated Thank You email if email exists
                if email_addr:
                    # Get template from settings
                    template_key = "posh_thank_you_template" if category == "POSH" else "contact_us_thank_you_template"
                    cursor = await db.execute("SELECT value FROM system_settings WHERE key = ?", (template_key,))
                    row = await cursor.fetchone()
                    template_html = row["value"] if row else (
                        POSH_DEFAULT_TEMPLATE if category == "POSH" else CONTACT_US_DEFAULT_TEMPLATE
                    )
                    
                    # Replace placeholders
                    formatted_html = template_html
                    replacements = {
                        "{{ $json.name }}": str(extracted.get("name") or extracted.get("contact_person") or "N/A"),
                        "{{ $json.email }}": str(extracted.get("email_id") or extracted.get("email") or "N/A"),
                        "{{ $json.phone }}": str(extracted.get("phone") or "N/A"),
                        "{{ $json.company_name }}": str(extracted.get("company_name") or extracted.get("company") or "N/A"),
                        "{{ $json.city }}": str(extracted.get("city") or "N/A"),
                        "{{ $json.services_interested_in }}": str(extracted.get("services_interested_in") or "N/A"),
                        "{{ $json.posh_interest }}": str(extracted.get("posh_interest") or "N/A"),
                        "{{ $json.training_mode }}": str(extracted.get("training_mode") or "N/A"),
                        "{{ $json.number_of_employees }}": str(extracted.get("number_of_employees") or "N/A"),
                        "{{ $json.preferred_timeline }}": str(extracted.get("preferred_timeline") or "N/A"),
                        "{{ $json.requirement_message }}": str(extracted.get("requirement_message") or "N/A"),
                        "{{ $json.website }}": str(extracted.get("website") or "N/A"),
                        "{{ $json.turnover }}": str(extracted.get("turnover") or "N/A"),
                        "{{ $json.employee_size }}": str(extracted.get("employee_size") or "N/A"),
                    }
                    
                    for key, val in replacements.items():
                        formatted_html = formatted_html.replace(key, val)
                        
                    # Send email
                    res = send_email(
                        to_email=email_addr,
                        subject="Thank you for reaching out to D&V Business Consulting",
                        body=formatted_html,
                        html=True
                    )
                    if res["success"]:
                        print(f"[GMAIL FETCH] Thank You email sent to {email_addr}")
                    else:
                        print(f"[GMAIL FETCH] Failed to send Thank You email to {email_addr}: {res['message']}")
                        
            except ValueError as e:
                print(f"[GMAIL FETCH] Duplicate or invalid lead: {e}")
            except Exception as e:
                print(f"[GMAIL FETCH] DB Error creating lead: {e}")
