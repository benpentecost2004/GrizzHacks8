import os
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

def detect_ai_image(image_path: str) -> DetectionResult:
    try:
        img = Image.open(image_path)
    except Exception as e:
        return json.dumps({"error": f"Failed to open image: {str(e)}"})
    
    prompt_text = prompts.get("image_prompt", "Analyze this image and determine if it is AI-generated or real.")

    try:
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
    except Exception as e:
        return json.dumps({"error": f"API call failed: {str(e)}"})
    


