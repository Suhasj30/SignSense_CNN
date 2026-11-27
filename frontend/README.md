# SignSense Frontend

React/Vite frontend for SignSense. The camera preview stays local in the browser. Recognition sends resized frames to the FastAPI backend over WebSocket and uses the loaded trained CNN; the frontend does not generate simulated predictions.

## Run locally

```bash
cd ~/Desktop/SignSense_CNN/frontend
npm install
cp -n .env.example .env
npm run dev
```

`VITE_BACKEND_URL` in the local `.env` selects the backend (default `http://127.0.0.1:8000`). Open the localhost URL printed by Vite. Production assets can be built with `npm run build`.

## Try the camera

Use **Start camera** and allow browser camera permission, then choose **Start recognition**. The header shows whether the backend and model are available. Stop the camera to stop recognition and release the device. Camera access requires localhost or HTTPS in browsers. Frames are sent to the backend only while recognition is running.

## Try recognition and sentence building

Live CNN predictions append to the editable sentence when confidence and cooldown filters pass. Consecutive repeats of the same prediction are ignored until the predicted class changes. Use **Add space**, **Delete last**, **Clear**, or **Add word** to edit the translation. SPACE and delete are UI controls, not classes predicted by the model.

## Test text-to-speech

Type or build a sentence, then select **Speak sentence**. Gemini generates WAV audio through the local backend; the API key remains backend-only. Use **Stop** to interrupt playback or an in-flight request. Auto-speak is off initially and triggers for added words or sentence-ending punctuation, never individual predicted letters.

## History and settings

Translations sent to speech playback appear in **Translation history**, where they can be replayed, copied, or deleted. Settings and history use separate localStorage services and stay in this browser. Use **Settings** for voice, speech, camera, confidence, and cooldown preferences.

## CNN integration seam

`src/services/backendConfig.ts` configures the backend HTTP/WebSocket URLs. `src/hooks/useBackendHealth.ts` polls model/backend readiness. `src/services/recognitionService.ts` sends camera frames to the backend and reconnects after transient WebSocket failures. Gemini TTS requests use the backend `/tts` endpoint and receive WAV audio; `GEMINI_API_KEY` belongs in the project-root backend `.env`, never in frontend configuration.

## Project layout

```text
src/
├── components/     # Dashboard, camera, predictions, sentence, history, settings
├── hooks/          # Camera and browser speech state
├── services/       # Camera, recognition, history, local settings
├── App.tsx
├── types.ts
└── styles.css
```
