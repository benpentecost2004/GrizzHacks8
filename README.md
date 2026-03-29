# GrizzHacks8

Verity is a Chrome extension + Python backend that analyzes selected text, images, and videos for AI-generation likelihood using Gemini.

## Quick Start

1. Clone this repository.
2. Install Python dependencies:

	 ```bash
	 pip install -r requirements.txt
	 ```

3. Create a `.env` file in `Backend/gemini/` with your Gemini key:

	 ```env
	 GOOGLE_API_KEY=your_key_here
	 ```

4. Start the backend server:

	 ```bash
	 cd Backend/gemini
	 python server.py
	 ```

5. Load the extension in Chrome:
	 - Open `chrome://extensions/`
	 - Enable Developer Mode
	 - Click Load unpacked
	 - Select the repository root folder

## Project Structure

### Extension entry and wiring

- `manifest.json`
	- Declares runtime entry points:
		- service worker: `Chrome Extension/background.js`
		- popup: `Chrome Extension/popup.html`
		- content script: `Chrome Extension/content.js`
		- content CSS: `Chrome Extension/styles/content.css`
	- Declares host permissions for backend requests to `127.0.0.1:8000`.

### Chrome extension files

- `Chrome Extension/background.js`
	- Central controller for user actions.
	- Registers right-click context menu items (text/image/video).
	- Sends HTTP requests to backend endpoints:
		- `POST /analyze-text`
		- `POST /analyze-image`
		- `POST /analyze-video`
	- Forwards backend results to content script as extension messages:
		- `text-result`
		- `image-result`
		- `video-result`

- `Chrome Extension/content.js`
	- Runs on web pages.
	- Receives result messages from `background.js`.
	- Highlights detected text spans in the page DOM.
	- Renders image/video overlays with confidence badges.
	- Stores scan history in `chrome.storage.local` under `aidet-history`.

- `Chrome Extension/popup.html`
	- Extension popup UI container.

- `Chrome Extension/popup.js`
	- Reads and renders history from `chrome.storage.local`.
	- Shows latest score, reason, and past scans.

- `Chrome Extension/styles/content.css`
	- Visual styles for in-page highlights and media overlays.

- `Chrome Extension/styles/popup.css`
	- Visual styles for popup history and detail cards.

### Backend files

- `Backend/gemini/server.py`
	- Flask API used by the extension.
	- Endpoints:
		- `GET /health`
		- `POST /analyze-text`
		- `POST /analyze-image`
		- `POST /analyze-video`
	- Normalizes model confidence to `0-100`.
	- Handles URL/data-URL image loading, AVIF conversion path, and video temp-file lifecycle.

- `Backend/gemini/geminiTextCall.py`
	- Gemini text detection call.
	- Uses `text_prompt` from `prompts.json`.

- `Backend/gemini/geminiImageCall.py`
	- Gemini image detection call.
	- Uses `image_prompt` from `prompts.json`.

- `Backend/gemini/geminiVideoCall.py`
	- Video frame extraction + Gemini frame analysis.
	- Uses `video_prompt` from `prompts.json`.

- `Backend/gemini/prompts.json`
	- Prompt templates for text, image, and video analysis.

## Runtime Interaction Flow

### Text analysis flow

1. User highlights page text and clicks context menu Analyze text with Verity.
2. `background.js` receives the click event and sends selected text to `POST /analyze-text`.
3. `server.py` calls `geminiTextCall.py` with `text_prompt`.
4. Backend returns `{ label, confidence, reasoning }`.
5. `background.js` forwards a `text-result` message to `content.js`.
6. `content.js` highlights matching text and stores the result in history.
7. `popup.js` reads that history and displays it in the popup.

### Image analysis flow

1. User right-clicks an image and starts image analysis.
2. `background.js` posts `imageUrl` to `POST /analyze-image`.
3. `server.py` downloads/decodes image and calls `geminiImageCall.py`.
4. Result returns to extension and `content.js` overlays a confidence pill on the image.
5. `popup.js` shows the saved image result in history.

### Video analysis flow

1. User right-clicks a video and starts video analysis.
2. `background.js` sends `videoUrl` to `POST /analyze-video`.
3. `server.py` downloads video, extracts frames, and calls `geminiVideoCall.py`.
4. Aggregated result returns to extension and `content.js` renders video overlays.
5. `popup.js` shows the saved video result.

## Message Contracts (Extension Internal)

Main messages from `background.js` to `content.js`:

- `text-result`
- `image-loading`
- `image-result`
- `video-loading`
- `video-result`
- `find-image`
- `find-video`

Main messages from `content.js` to `background.js`:

- `open-popup`
- `found-image`
- `found-video`
- `analyze-video-frame`
- `analyze-text`

## Notes

- Extension and backend are coupled through local API URLs in `Chrome Extension/background.js`.
- If you change backend host/port, update the API constants in `background.js` and host permissions in `manifest.json`.

