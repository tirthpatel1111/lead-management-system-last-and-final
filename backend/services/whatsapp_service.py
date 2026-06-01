"""
WhatsApp Service — Send WhatsApp messages via Interakt API.
Uses Interakt's WhatsApp Business API (https://api.interakt.ai).
Authentication: Basic Auth with API Key.
Only one credential needed: INTERAKT_API_KEY.
"""

import os
import json
import urllib.request
import urllib.parse
from dotenv import load_dotenv, set_key

load_dotenv()
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")

# ──────────────────────────────────────────────
#  Interakt Configuration
#  Configure these settings via the Admin panel
# ──────────────────────────────────────────────
INTERAKT_CONFIG = {
    "api_key": os.getenv("INTERAKT_API_KEY", ""),          # Interakt Secret Key (from Developer Settings)
    "template_name": os.getenv("INTERAKT_TEMPLATE_NAME", ""),  # WhatsApp template code name
    "language_code": os.getenv("INTERAKT_LANGUAGE_CODE", "en"),  # Template language code
}

INTERAKT_API_URL = "https://api.interakt.ai/v1/public/message/"


def is_interakt_configured() -> bool:
    """Check if Interakt settings are configured."""
    return bool(
        INTERAKT_CONFIG["api_key"]
        and INTERAKT_CONFIG["template_name"]
    )


def update_interakt_config(config: dict):
    """
    Update Interakt configuration at runtime and persist to .env.
    Called from the Admin settings panel.
    """
    if not os.path.exists(ENV_PATH):
        open(ENV_PATH, "a").close()

    key_map = {
        "api_key": "INTERAKT_API_KEY",
        "template_name": "INTERAKT_TEMPLATE_NAME",
        "language_code": "INTERAKT_LANGUAGE_CODE",
    }
    for key, env_key in key_map.items():
        if key in config and config[key]:
            INTERAKT_CONFIG[key] = config[key]
            set_key(ENV_PATH, env_key, str(config[key]))


def send_whatsapp(
    to_phone: str,
    template_name: str,
) -> dict:
    """
    Send a WhatsApp message via Interakt using a pre-approved template.

    Interakt requires a pre-approved WhatsApp template. Since the template
    is static, we pass an empty array for bodyValues.

    Args:
        to_phone: Recipient phone number with country code (e.g., "+919876543210")
        template_name:  The code name of the Meta-approved template to send.

    Returns:
        dict with 'success' (bool) and 'message' (str)
    """
    if not INTERAKT_CONFIG["api_key"]:
        return {
            "success": False,
            "message": (
                "Interakt is not configured. "
                "Go to Admin Panel → WhatsApp Settings and enter your API Key."
            ),
        }

    try:
        # Clean the phone number: remove spaces, dashes; ensure leading +
        phone = to_phone.strip().replace(" ", "").replace("-", "")

        # Split country code and local number
        # Interakt expects countryCode (e.g. "+91") and phoneNumber (e.g. "9876543210")
        if phone.startswith("+"):
            # Try to extract country code — support +91 (IN), +1 (US), etc.
            # Simple heuristic: if starts with +91 use +91 / rest
            if phone.startswith("+91") and len(phone) >= 13:
                country_code = "+91"
                local_number = phone[3:]
            elif phone.startswith("+1") and len(phone) >= 12:
                country_code = "+1"
                local_number = phone[2:]
            else:
                # Generic: first 3 chars are country code (+XX)
                country_code = phone[:3]
                local_number = phone[3:]
        else:
            # No leading +, assume +91 (India)
            country_code = "+91"
            local_number = phone

        payload = {
            "countryCode": country_code,
            "phoneNumber": local_number,
            "type": "Template",
            "template": {
                "name": template_name,
                "languageCode": INTERAKT_CONFIG.get("language_code", "en"),
                "bodyValues": [],
            },
        }

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            INTERAKT_API_URL,
            data=data,
            headers={
                "Authorization": f"Basic {INTERAKT_CONFIG['api_key']}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        # Interakt returns {"result": true, "message": "..."} on success
        if result.get("result") is True or result.get("success") is True:
            return {
                "success": True,
                "message": f"WhatsApp message sent via Interakt successfully.",
            }
        else:
            err_msg = result.get("message") or result.get("error") or str(result)
            return {"success": False, "message": f"Interakt error: {err_msg}"}

    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8")
            err_data = json.loads(body)
            err_msg = err_data.get("message") or err_data.get("error") or body
        except Exception:
            err_msg = str(e)
        return {"success": False, "message": f"Interakt HTTP error {e.code}: {err_msg}"}

    except Exception as e:
        return {"success": False, "message": f"WhatsApp (Interakt) failed: {str(e)}"}
