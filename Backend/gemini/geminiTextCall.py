import json
from dotenv import load_dotenv
from pydantic import BaseModel
from PIL import Image
from google import genai
from google.genai import types

load_dotenv()

client = genai.Client()

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