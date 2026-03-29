import json
import os
from dotenv import load_dotenv
from pydantic import BaseModel
from PIL import Image
from google import genai
from google.genai import types
from typing import Any, Dict

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Get API key from environment
api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
    raise ValueError('GOOGLE_API_KEY not found in environment. Please set it in a .env file.')

client = genai.Client(api_key=api_key)

try:
    with open(os.path.join(BASE_DIR, 'prompts.json'), 'r') as file:
        prompts = json.load(file)
except FileNotFoundError:
    print("prompts.json file not found. Please ensure it exists in the current directory.")
    exit(1)

class DetectionResult(BaseModel):
    label: str
    confidence: float
    reasoning: str

def _run_detection(img: Image.Image) -> str:
    prompt_text = prompts.get("image_prompt", "Analyze this image and determine if it is AI-generated or real.")

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[prompt_text, img],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=DetectionResult,
            temperature=0.2,
        ),
    )
    return response.text


def detect_ai_image(image_path: str) -> str:
    try:
        img = Image.open(image_path)
    except Exception as e:
        return json.dumps({"error": f"Failed to open image: {str(e)}"})

    try:
        return _run_detection(img)
    except Exception as e:
        return json.dumps({"error": f"API call failed: {str(e)}"})


def detect_ai_image_pil(img: Image.Image) -> str:
    try:
        return _run_detection(img)
    except Exception as e:
        return json.dumps({"error": f"API call failed: {str(e)}"})


def detect_ai_image_as_dict(img: Image.Image) -> Dict[str, Any]:
    raw = detect_ai_image_pil(img)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"error": "Model response was not valid JSON.", "raw": raw}
    


