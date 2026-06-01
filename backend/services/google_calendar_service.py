"""
Google Calendar Service — Schedule meetings and generate Google Meet links.
Uses OAuth2 with stored refresh tokens to create calendar events on admin's calendar.
Credentials are persisted to .env just like SMTP / Interakt settings.
"""

import os
import json
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta
from dotenv import load_dotenv, set_key

load_dotenv()
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")

# ──────────────────────────────────────────────
#  Google Calendar Configuration
# ──────────────────────────────────────────────
GCAL_CONFIG = {
    "client_id": os.getenv("GCAL_CLIENT_ID", ""),
    "client_secret": os.getenv("GCAL_CLIENT_SECRET", ""),
    "refresh_token": os.getenv("GCAL_REFRESH_TOKEN", ""),
    "calendar_email": os.getenv("GCAL_CALENDAR_EMAIL", ""),
}


def _reload_config():
    """Reload GCAL config from environment (picks up any runtime updates to .env)."""
    load_dotenv(dotenv_path=ENV_PATH, override=True)
    GCAL_CONFIG["client_id"]      = os.getenv("GCAL_CLIENT_ID", "")
    GCAL_CONFIG["client_secret"]  = os.getenv("GCAL_CLIENT_SECRET", "")
    GCAL_CONFIG["refresh_token"]  = os.getenv("GCAL_REFRESH_TOKEN", "")
    GCAL_CONFIG["calendar_email"] = os.getenv("GCAL_CALENDAR_EMAIL", "")


def is_gcal_configured() -> bool:
    """Check if Google Calendar credentials are set."""
    _reload_config()
    return bool(
        GCAL_CONFIG["client_id"]
        and GCAL_CONFIG["client_secret"]
        and GCAL_CONFIG["refresh_token"]
        and GCAL_CONFIG["calendar_email"]
    )


def update_gcal_config(config: dict):
    """
    Update Google Calendar configuration at runtime and persist to .env.
    Called from the Admin settings panel.
    """
    if not os.path.exists(ENV_PATH):
        open(ENV_PATH, "a").close()

    key_map = {
        "client_id":      "GCAL_CLIENT_ID",
        "client_secret":  "GCAL_CLIENT_SECRET",
        "refresh_token":  "GCAL_REFRESH_TOKEN",
        "calendar_email": "GCAL_CALENDAR_EMAIL",
    }

    for key, env_key in key_map.items():
        if key in config and config[key]:
            GCAL_CONFIG[key] = config[key]
            set_key(ENV_PATH, env_key, str(config[key]))


def _get_access_token() -> str:
    """
    Exchange the stored refresh token for a short-lived access token.
    Uses Google's OAuth2 token endpoint directly (no google-auth library required).

    Raises RuntimeError with a clear message on failure (including 401 / invalid_grant).
    """
    _reload_config()   # always use the latest credentials

    post_data = urllib.parse.urlencode({
        "client_id":     GCAL_CONFIG["client_id"],
        "client_secret": GCAL_CONFIG["client_secret"],
        "refresh_token": GCAL_CONFIG["refresh_token"],
        "grant_type":    "refresh_token",
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=post_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    # Google returns error details as JSON even for 4xx responses,
    # so we must read the HTTPError body to surface a meaningful message.
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as http_err:
        # Read the error body from Google for a meaningful error message
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
                f"Google OAuth refresh token is invalid or expired (invalid_grant). "
                f"Please generate a new refresh token and update it in Admin Panel → Google Calendar Settings. "
                f"Details: {err_desc}"
            )
        raise RuntimeError(
            f"Google OAuth token request failed ({http_err.code} {err_code}): {err_desc}"
        )
    except urllib.error.URLError as url_err:
        raise RuntimeError(f"Network error contacting Google OAuth: {url_err.reason}")

    if "access_token" not in result:
        err_code = result.get("error", "unknown")
        err_desc = result.get("error_description", str(result))
        raise RuntimeError(f"Token refresh failed ({err_code}): {err_desc}")

    return result["access_token"]


def schedule_meeting(
    title: str,
    description: str,
    start_datetime: str,   # ISO 8601 format: "2026-04-25T10:00:00"
    duration_minutes: int = 60,
    attendee_email: str = None,
    salesperson_email: str = None,
    cc_emails: list = None,
) -> dict:
    """
    Create a Google Calendar event with a Google Meet link.

    Args:
        title: Event title
        description: Event description
        start_datetime: Meeting start time (ISO 8601, local time assumed IST)
        duration_minutes: Meeting duration in minutes (default 60)
        attendee_email: Lead's email to invite (optional)
        salesperson_email: Salesperson's email to invite (optional)
        cc_emails: Additional CC emails to add as attendees (optional)

    Returns:
        dict with 'success', 'event_link', 'meet_link', and 'message'
    """
    if not is_gcal_configured():
        return {
            "success": False,
            "meet_link": None,
            "event_link": None,
            "message": (
                "Google Calendar is not configured. "
                "Please set Client ID, Client Secret, Refresh Token, and Calendar Email in Admin Panel."
            ),
        }

    try:
        access_token = _get_access_token()

        # Parse start time and compute end time
        start_dt = datetime.fromisoformat(start_datetime)
        end_dt   = start_dt + timedelta(minutes=duration_minutes)

        # Calendar timezone (IST)
        timezone = "Asia/Kolkata"

        # Build attendees list
        attendees = [{"email": GCAL_CONFIG["calendar_email"]}]
        if attendee_email and attendee_email != GCAL_CONFIG["calendar_email"]:
            attendees.append({"email": attendee_email})
        # Add salesperson as attendee (deduplicate against admin + client)
        seen = {e["email"] for e in attendees}
        if salesperson_email and salesperson_email not in seen:
            attendees.append({"email": salesperson_email})
            seen.add(salesperson_email)
        # Add CC emails as additional attendees (deduplicated)
        if cc_emails:
            for cc in cc_emails:
                cc_clean = cc.strip().lower()
                if cc_clean and cc_clean not in seen:
                    attendees.append({"email": cc_clean})
                    seen.add(cc_clean)

        event_body = {
            "summary": title,
            "description": description,
            "start": {
                "dateTime": start_dt.isoformat(),
                "timeZone": timezone,
            },
            "end": {
                "dateTime": end_dt.isoformat(),
                "timeZone": timezone,
            },
            "attendees": attendees,
            "conferenceData": {
                "createRequest": {
                    "requestId": f"meet-{int(start_dt.timestamp())}",
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            },
            "reminders": {
                "useDefault": False,
                "overrides": [
                    {"method": "email",  "minutes": 60},
                    {"method": "popup",  "minutes": 15},
                ],
            },
        }

        # Calendar ID is the admin's email
        calendar_id = GCAL_CONFIG["calendar_email"]
        url = (
            f"https://www.googleapis.com/calendar/v3/calendars/"
            f"{urllib.parse.quote(calendar_id)}/events"
            f"?conferenceDataVersion=1&sendUpdates=all"
        )

        payload = json.dumps(event_body).encode("utf-8")
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
                err_msg  = err_data.get("error", {}).get("message", err_body)
            except Exception:
                err_msg = f"HTTP {http_err.code}: {http_err.reason}"
            return {
                "success": False,
                "meet_link": None,
                "event_link": None,
                "message": f"Failed to create calendar event: {err_msg}",
            }

        meet_link = None
        if "conferenceData" in result and "entryPoints" in result["conferenceData"]:
            for ep in result["conferenceData"]["entryPoints"]:
                if ep.get("entryPointType") == "video":
                    meet_link = ep.get("uri")
                    break

        return {
            "success": True,
            "event_id":   result.get("id"),
            "event_link": result.get("htmlLink"),
            "meet_link":  meet_link,
            "message":    "Meeting scheduled successfully on Google Calendar.",
        }

    except RuntimeError as e:
        return {"success": False, "meet_link": None, "event_link": None, "message": str(e)}
    except Exception as e:
        return {
            "success": False,
            "meet_link": None,
            "event_link": None,
            "message": f"Failed to schedule meeting: {str(e)}",
        }
