"""
OCR Service — Extract business card data using Tesseract OCR.
Parses the extracted text to identify company name, email, and phone number.
"""

import re
import os
from PIL import Image

import os
import json
import base64
from dotenv import load_dotenv

# Try to import groq
try:
    from groq import Groq
    GROQ_AVAILABLE = True
except ImportError:
    GROQ_AVAILABLE = False

load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

def encode_image(image_path: str) -> str:
    """Encode image to base64 string."""
    with open(image_path, "rb") as img_file:
        return base64.b64encode(img_file.read()).decode("utf-8")


def extract_text_from_image(image_path: str) -> str:
    """
    Run OCR on an image file using Groq LLM.
    Returns the extracted JSON text.
    """
    if not GROQ_AVAILABLE:
        raise RuntimeError("Groq library is not installed. Run: pip install groq")
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is missing in .env file.")

    client = Groq(api_key=GROQ_API_KEY)
    base64_image = encode_image(image_path)

    prompt = """
    You are an information extraction system.

    Extract ONLY the following fields from the visiting card:
    - company
    - contact_person
    - email
    - phone

    Rules:
    - Return STRICT JSON only
    - If a field is missing, return null
    - No extra text, no explanation
    - If multiple email ids or phone numbers are present, extract only one of them according to the visibility or give priority of work position.
    - Also give that name in contect person name example like : if you use to featch "xyz : 1234567890" this number then you give name in contect person "xyz" according to the content you featch and if you not see any person name then put it blank.

    Example output:
    {
        "company": "ABC Pvt Ltd",
        "contact_person": "John Doe",
        "email": "john@abc.com",
        "phone": "+91-9876543210"
    }
    """

    response = client.chat.completions.create(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{base64_image}"
                        },
                    },
                ],
            }
        ],
        temperature=0,
        max_tokens=300,
    )

    return response.choices[0].message.content


def parse_business_card(text: str) -> dict:
    """
    Parse JSON text from Groq to extract structured data.
    """
    result = {
        "company_name": None,
        "contact_name": None,
        "email": None,
        "phone": None,
        "raw_text": text,
    }

    try:
        # Extract JSON using regex
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            clean_text = match.group(0)
            data = json.loads(clean_text)
            result["company_name"] = data.get("company")
            result["contact_name"] = data.get("contact_person")
            result["email"] = data.get("email")
            
            # Format phone slightly
            phone = data.get("phone")
            if phone:
                result["phone"] = str(phone).strip()
    except Exception as e:
        print(f"Failed to decode JSON from Groq: {e}\nText: {text}")

    return result
