# SignSense Frontend

Standalone React/Vite frontend for SignSense. This app lives separately from both the original `~/Desktop/ASL` project and the CNN training code. It currently uses an explicitly labeled mock recognizer; no CNN inference backend is connected.

## Run locally

```bash
cd ~/Desktop/SignSense_CNN/frontend
npm install
npm run dev
```

Open the localhost URL printed by Vite. Production assets can be built with `npm run build`.

## Try the camera

Use **Start camera** and allow browser camera permission. Camera preview is a separate feature from recognition and runs locally in the browser. Stop it with **Stop camera**. Camera access requires localhost or HTTPS in browsers. No camera footage is uploaded or recorded.

## Try recognition and sentence building

Select **Run demo** on the Recognition card to receive simulated signs, or choose any character under **Try a character** and select **Add sign**. The UI clearly labels these as mock predictions and indicates that the CNN is not connected.

Recognized characters append to the editable sentence. Repeated predictions of a held sign are ignored until the detected sign changes; the cooldown and confidence threshold are configurable under **Settings**. Use **Add space**, **Delete last**, **Clear**, or **Add word** to edit the translation.

## Test text-to-speech

Type or build a sentence, choose a system voice if available, then select **Speak sentence**. Adjust speed and pitch or use Pause, Resume, and Stop during playback. The app uses `speechSynthesis` and `SpeechSynthesisUtterance`; voices depend on the browser and operating system. If speech synthesis is unavailable or playback fails, the controls show an explicit status/error. Auto-speak is off initially and only triggers for completed words or sentence punctuation, never each predicted letter.

## History and settings

Translations sent to speech playback appear in **Translation history**, where they can be replayed, copied, or deleted. Settings and history use separate localStorage services and stay in this browser. Use **Settings** for voice, speech, camera, confidence, and cooldown preferences.

## CNN integration seam

`src/services/recognitionService.ts` defines the `RecognitionService` interface and prediction contract (`className`, `confidence`, `timestamp`, `status`, and `source`). `MockRecognitionService` implements that contract for development. Replace or add a CNN-backed service that emits the same `Prediction` shape; keep camera acquisition in `cameraService.ts` and let the existing prediction processor and UI consume that service. The current mock service does not call the trained model or a backend.

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
