"""
Email Service — Send emails using the Gmail API via OAuth2.
Replaces the old SMTP-based sending with a fast single HTTPS POST.
Supports HTML and plain-text emails.
Credentials are fully independent from Google Calendar.
"""

import os
import json
import base64
import urllib.request
import urllib.error
import urllib.parse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from dotenv import load_dotenv, set_key

# Load environment variables
load_dotenv()
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")

# ──────────────────────────────────────────────
#  Gmail API Configuration
#  Fully independent from Google Calendar credentials.
#  Configure these settings via the Admin panel
#  or set them as environment variables.
# ──────────────────────────────────────────────
GMAIL_CONFIG = {
    "client_id": os.getenv("GMAIL_CLIENT_ID", ""),
    "client_secret": os.getenv("GMAIL_CLIENT_SECRET", ""),
    "refresh_token": os.getenv("GMAIL_REFRESH_TOKEN", ""),
    "from_email": os.getenv("GMAIL_FROM_EMAIL", ""),
    "from_name": os.getenv("GMAIL_FROM_NAME", "Lead Manager"),
}


def _reload_config():
    """Reload Gmail config from environment (picks up any runtime updates to .env)."""
    load_dotenv(dotenv_path=ENV_PATH, override=True)
    GMAIL_CONFIG["client_id"]     = os.getenv("GMAIL_CLIENT_ID", "")
    GMAIL_CONFIG["client_secret"] = os.getenv("GMAIL_CLIENT_SECRET", "")
    GMAIL_CONFIG["refresh_token"] = os.getenv("GMAIL_REFRESH_TOKEN", "")
    GMAIL_CONFIG["from_email"]    = os.getenv("GMAIL_FROM_EMAIL", "")
    GMAIL_CONFIG["from_name"]     = os.getenv("GMAIL_FROM_NAME", "Lead Manager")


def is_gmail_configured() -> bool:
    """Check if Gmail API settings are configured."""
    _reload_config()
    return bool(
        GMAIL_CONFIG["client_id"]
        and GMAIL_CONFIG["client_secret"]
        and GMAIL_CONFIG["refresh_token"]
        and GMAIL_CONFIG["from_email"]
    )


def update_gmail_config(config: dict):
    """
    Update Gmail API configuration at runtime and persist to .env.
    Called from the Admin settings panel.
    """
    if not os.path.exists(ENV_PATH):
        open(ENV_PATH, "a").close()

    key_map = {
        "client_id":     "GMAIL_CLIENT_ID",
        "client_secret": "GMAIL_CLIENT_SECRET",
        "refresh_token": "GMAIL_REFRESH_TOKEN",
        "from_email":    "GMAIL_FROM_EMAIL",
        "from_name":     "GMAIL_FROM_NAME",
    }

    for key, env_key in key_map.items():
        if key in config:
            # Skip masked values — admin didn't change them
            if key in ("client_secret", "refresh_token") and config[key] == "***":
                continue

            GMAIL_CONFIG[key] = config[key]
            set_key(ENV_PATH, env_key, str(config[key]))


def _get_access_token() -> str:
    """
    Exchange the stored refresh token for a short-lived access token.
    Uses Google's OAuth2 token endpoint directly (no extra libraries needed).

    Raises RuntimeError with a clear message on failure.
    """
    _reload_config()

    post_data = urllib.parse.urlencode({
        "client_id":     GMAIL_CONFIG["client_id"],
        "client_secret": GMAIL_CONFIG["client_secret"],
        "refresh_token": GMAIL_CONFIG["refresh_token"],
        "grant_type":    "refresh_token",
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
    except urllib.error.HTTPError as http_err:
        try:
            err_body = http_err.read().decode("utf-8")
            err_data = json.loads(err_body)
            err_code = err_data.get("error", "unknown_error")
            err_desc = err_data.get("error_description", err_body)
        except Exception:
            err_code = str(http_err.code)
            err_desc = str(http_err.reason)

        if err_code == "invalid_grant":
            raise RuntimeError(
                f"Gmail OAuth refresh token is invalid or expired (invalid_grant). "
                f"Please generate a new refresh token and update it in Admin Panel → Gmail API Settings. "
                f"Details: {err_desc}"
            )
        raise RuntimeError(
            f"Gmail OAuth token request failed ({http_err.code} {err_code}): {err_desc}"
        )
    except urllib.error.URLError as url_err:
        raise RuntimeError(f"Network error contacting Google OAuth: {url_err.reason}")

    if "access_token" not in result:
        err_code = result.get("error", "unknown")
        err_desc = result.get("error_description", str(result))
        raise RuntimeError(f"Gmail token refresh failed ({err_code}): {err_desc}")

    return result["access_token"]


def send_email(
    to_email: str,
    subject: str,
    body: str,
    html: bool = False,
    cc_emails: list = None,
    booking_url: str = None,
    tracking_pixel_url: str = None,
) -> dict:
    """
    Send an email via the Gmail API.

    Args:
        to_email: Recipient email address
        subject: Email subject line
        body: Email body (plain text or HTML)
        html: If True, body is treated as HTML
        cc_emails: Optional list of CC email addresses
        booking_url: Optional booking link URL to append as a CTA button

    Returns:
        dict with 'success' (bool) and 'message' (str)
    """
    if not is_gmail_configured():
        return {
            "success": False,
            "message": "Gmail API is not configured. Go to Settings to configure email.",
        }

    try:
        # 1. Get a fresh access token
        access_token = _get_access_token()

        # 1b. Inject "Book an Appointment" button if booking_url is provided
        if booking_url:
            booking_button_html = f"""
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #E5E7EB;padding-top:20px;" align="center">
  <tr>
    <td align="center">
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;" align="center">
        <tr>
          <td style="padding:12px 0 6px;text-align:center;font-size:14px;color:#6B7280;font-family:Arial,sans-serif;" align="center">
            📅 Would you like to schedule a meeting with us?
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:8px 0 12px;text-align:center;">
            <a href="{booking_url}" target="_blank"
               style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#2563EB,#1D4ED8);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;font-family:Arial,sans-serif;letter-spacing:0.02em;box-shadow:0 4px 12px rgba(37,99,235,0.3);">
              📅 Book an Appointment
            </a>
          </td>
        </tr>
        <tr>
          <td style="text-align:center;font-size:12px;color:#9CA3AF;font-family:Arial,sans-serif;padding-top:4px;" align="center">
            Click above to choose a convenient time for our meeting
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
"""
            if html:
                # Insert before closing </body> or </html> tag, or append at end
                body_lower = body.lower()
                if "</body>" in body_lower:
                    idx = body_lower.rfind("</body>")
                    body = body[:idx] + booking_button_html + body[idx:]
                elif "</html>" in body_lower:
                    idx = body_lower.rfind("</html>")
                    body = body[:idx] + booking_button_html + body[idx:]
                else:
                    body = body + booking_button_html
            else:
                # For plain text, append a simple text link
                body = body + f"\n\n---\n📅 Book an Appointment: {booking_url}\n"

        # 1c. Inject D&V logo + hidden tracking pixel if tracking_pixel_url is provided
        if tracking_pixel_url:
            tracking_img_html = f"""
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;" align="center">
  <tr>
    <td align="center">
      <img src="https://www.dvconsulting.co.in/wp-content/uploads/2024/07/DV-Business-Consulting-Logo-scaled.jpg" width="120" height="auto" style="display:block;max-width:120px;border:0;outline:none;" alt="D&V Business Consulting" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="{tracking_pixel_url}" width="1" height="1" style="display:block;border:0;outline:none;opacity:0;" alt="" />
    </td>
  </tr>
</table>
"""
            if html:
                body_lower = body.lower()
                if "</body>" in body_lower:
                    idx = body_lower.rfind("</body>")
                    body = body[:idx] + tracking_img_html + body[idx:]
                elif "</html>" in body_lower:
                    idx = body_lower.rfind("</html>")
                    body = body[:idx] + tracking_img_html + body[idx:]
                else:
                    body = body + tracking_img_html
            else:
                # For plain-text emails, wrap in basic HTML to support tracking
                body = f"""<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
<pre style="white-space:pre-wrap;font-family:inherit;">{body}</pre>
{tracking_img_html}
</body></html>"""
                html = True  # Now it's HTML

        # 2. Build the email message (RFC 2822)
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{GMAIL_CONFIG['from_name']} <{GMAIL_CONFIG['from_email']}>"
        msg["To"] = to_email
        msg["Subject"] = subject

        # Add CC header if CC emails are provided
        if cc_emails:
            # Deduplicate and filter out the To address
            clean_cc = list({e.strip().lower() for e in cc_emails if e and e.strip() and e.strip().lower() != to_email.lower()})
            if clean_cc:
                msg["Cc"] = ", ".join(clean_cc)

        content_type = "html" if html else "plain"
        msg.attach(MIMEText(body, content_type, "utf-8"))

        # 3. Base64url-encode the raw message
        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

        # 4. POST to Gmail API
        url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
        payload = json.dumps({"raw": raw_message}).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as http_err:
            try:
                err_body = http_err.read().decode("utf-8")
                err_data = json.loads(err_body)
                err_msg = err_data.get("error", {}).get("message", err_body)
            except Exception:
                err_msg = f"HTTP {http_err.code}: {http_err.reason}"
            return {"success": False, "message": f"Gmail API error: {err_msg}"}

        return {"success": True, "message": f"Email sent successfully to {to_email}"}

    except RuntimeError as e:
        return {"success": False, "message": str(e)}
    except Exception as e:
        return {"success": False, "message": f"Email failed: {str(e)}"}


