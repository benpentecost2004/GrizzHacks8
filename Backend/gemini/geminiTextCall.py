import json
import os
from dotenv import load_dotenv
from pydantic import BaseModel
from PIL import Image
from google import genai
from google.genai import types

load_dotenv()

# Get API key from environment
api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
    raise ValueError('GOOGLE_API_KEY not found in environment. Please set it in a .env file.')

client = genai.Client(api_key=api_key)

try:
    with open('prompts.json', 'r') as file:
        prompts = json.load(file)
except FileNotFoundError:
    print("prompts.json file not found. Please ensure it exists in the current directory.")
    exit(1)

class DetectionResult(BaseModel):
    label: str
    confidence: float
    reasoning: str

def detect_ai_text(text: str) -> DetectionResult:
    prompt_text = prompts.get("text_prompt", "State that the prompt was not properly read")

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[prompt_text, text],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=DetectionResult,
                temperature=0.2,
            ),
        )
        return response.text
    except Exception as e:
        return json.dumps({"error": f"API call failed: {str(e)}"})