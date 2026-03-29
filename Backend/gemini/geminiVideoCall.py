import json
import cv2
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

def _analyze_image_obj(img: Image.Image) -> DetectionResult | dict:
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
        return json.loads(response.text)
    except Exception as e:
        return {"error": f"API call failed: {str(e)}"}

def detect_ai_image(image_path: str) -> str:
    try:
        img = Image.open(image_path)
        result = _analyze_image_obj(img)
        return json.dumps(result)
    except Exception as e:
        return json.dumps({"error": f"Failed to open image: {str(e)}"})

def detect_ai_video(video_path: str, num_frames: int = 5) -> str:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return json.dumps({"error": "Failed to open video file."})
    
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames == 0:
        return json.dumps({"error": "Video has no frames."})

    step = max(total_frames // num_frames, 1)
    frame_results = []

    for i in range(num_frames):
        frame_idx = min(i * step, total_frames - 1)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        
        if ret:
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(frame_rgb)

            res = _analyze_image_obj(pil_img)
            if "error" not in res:
                frame_results.append(res)
    
    cap.release()

    if not frame_results:
        return json.dumps({"error": "Failed to analyze any video frames."})

    avg_confidence = sum(r["confidence"] for r in frame_results) / len(frame_results)
    
    labels = [r["label"].lower() for r in frame_results]
    ai_votes = sum(1 for label in labels if "ai" in label or label == "fake")
    real_votes = len(labels) - ai_votes
    final_label = "AI-generated" if ai_votes > real_votes else "Real"
    
    combined_reasoning = " | ".join([f"Frame {i+1}: {r['reasoning']}" for i, r in enumerate(frame_results)])

    final_result = DetectionResult(
        label=final_label,
        confidence=avg_confidence,
        reasoning=combined_reasoning
    )
    
    return final_result.model_dump_json()