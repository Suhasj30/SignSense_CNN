# SignSense CNN

A standalone development project for training and evaluating an ASL image classifier. It uses the prepared participant-separated ASL-HG splits and does not modify the original `~/Desktop/ASL` project or the source dataset.

## Model and training approach

The default model is torchvision MobileNetV3Small with ImageNet weights and a replacement 36-class head. Stage 1 freezes the feature extractor and trains the classifier. Stage 2 fine-tunes the upper feature blocks and classifier at a lower learning rate. The factory also supports MobileNetV3Large, ResNet18, and EfficientNet-B0 for future experiments. MobileNetV3Small is the recommended lightweight webcam baseline.

All images are converted to RGB, resized to 224x224, and normalized with ImageNet statistics. Training-only augmentation applies a small affine rotation/translation/scale and mild brightness/contrast changes. Horizontal flipping is intentionally not used. Validation and test data use deterministic preprocessing only.

## Dataset

The default configuration reads the existing split directories:

```text
~/datasets/asl_hg/splits/
├── train/  # participants P1-P7
├── val/    # participants P8-P9
└── test/   # participant P10
```

Each split must contain the same 36 class folders (`0`-`9`, `A`-`Z`). The project uses these folders exactly as provided; it does not resplit or copy images. Class names are sorted once from the training folders and checked against validation and test. Broken or unreadable image links/files are excluded with a warning and sample paths in the log.

## Environment and dependencies

Activate the existing environment; no new environment is needed:

```bash
source ~/Desktop/ASL/.venv/bin/activate
cd ~/Desktop/SignSense_CNN
```

`requirements.txt` documents runtime dependencies. Check the environment before installing anything. No package is automatically installed by this project, and TensorFlow is not used. The existing environment in this workspace already has PyTorch, torchvision, NumPy, Pillow, PyYAML, tqdm, scikit-learn, matplotlib, and OpenCV. The pretrained ImageNet weights are fetched by torchvision on the first run if not already cached; this is a model-weight download, not a dataset download.

## Preflight (run before training)

```bash
python main.py validate
```

This checks all three split paths, requires exactly 36 matching classes, initializes the DataLoaders and fetches a batch from each, runs a forward pass, and checks for 36 output logits. It does not train or evaluate on the test set. Resolve any reported path, unreadable-image, download, or memory issue before training.

## Training

```bash
python main.py train
```

The command runs stage 1 and stage 2, saves the best checkpoint selected by validation accuracy, writes training history and plots, then evaluates that checkpoint on the participant-P10 test split exactly once as the final evaluation for that training run. It does not start training automatically from `validate`.

The defaults are batch size 32, at most 20 head-training epochs, at most 10 fine-tuning epochs, Adam, learning rates 0.001 and 0.00001, weight decay 0.0001, and early stopping after five epochs without validation-accuracy improvement. CUDA is selected automatically when available; CPU is supported. If memory is limited, reduce `training.batch_size` or `training.num_workers` in `config/config.yaml`.

## Evaluation

```bash
python main.py evaluate
```

By default this uses the checkpoint named in `models/checkpoints/best_model.json`. To evaluate a specific checkpoint:

```bash
python main.py evaluate --checkpoint models/checkpoints/mobilenet_v3_small_best_YYYYMMDD_HHMMSS.pth
```

The explicit evaluation command performs a new test-set evaluation. Training's final evaluation and explicit later evaluation are separate runs. Metrics include test/top-1/top-3 accuracy, per-class precision/recall/F1/support, macro and weighted averages, and focused directional confusion counts for M/N, U/V, O/0, and I/1. No test result is used to select the model.

Since P10 is excluded from training and validation, test metrics estimate generalization to an unseen signer. They are not a guarantee of performance across all signers, camera conditions, or continuous signing.

## Real-time backend and frontend

The backend loads the trained MobileNetV3Small checkpoint once at startup and serves predictions over a WebSocket, using CUDA when available or CPU otherwise. The browser sends resized 224x224 JPEG frames at most four times per second while a prediction is in flight. Webcam frames are processed by the local backend and are not written to disk. The checkpoint contains 36 classes (A–Z and 0–9); SPACE and delete are sentence-builder controls, not model classes.

Gemini TTS is served separately over `POST /tts`; it returns WAV audio and does not reload or run the CNN for speech requests. The default model is `gemini-3.8-flash-lite-tts` with the `Kore` voice. The backend automatically reads the API key from the repository-root `.env` file, which is ignored by Git:

```bash
cd ~/Desktop/SignSense_CNN
cp -n .env.example .env
# Edit .env and replace this example line with an active Google AI Studio API key:
# GEMINI_API_KEY=YOUR_VALID_GOOGLE_AI_STUDIO_API_KEY
source ~/Desktop/ASL/.venv/bin/activate
python -m pip install -r requirements.txt
```

If Gemini reports `API_KEY_INVALID`, the key is present but Google rejects it; replace the value on that line with a valid key from Google AI Studio. Do not put the key in frontend files or share it in chat.

`GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE`, `GEMINI_TTS_TIMEOUT_SECONDS`, and `SIGNSENSE_DEVICE` can be set in `.env`. `SIGNSENSE_DEVICE` accepts `auto` (default), `cuda`, or `cpu`. The API key is only read by the backend and is never sent to the frontend. Auto-speak is off by default; when enabled, it speaks after **Add word** or when sentence-ending punctuation is entered. CNN predictions do not trigger speech per frame. Use **Speak sentence** to speak the current text manually.

Use the existing environment referenced above; these commands do not change the separate `~/Desktop/ASL` project:

Terminal 1 — backend, from the SignSense project root:

```bash
source ~/Desktop/ASL/.venv/bin/activate
cd ~/Desktop/SignSense_CNN
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

The selected checkpoint is `models/checkpoints/mobilenet_v3_small_best_20261126_100259.pth`. Check readiness and the selected inference device at [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health). `SIGNSENSE_CHECKPOINT` can override the checkpoint path, `SIGNSENSE_CORS_ORIGINS` can set comma-separated allowed browser origins, and `SIGNSENSE_TORCH_THREADS` can set the CPU thread count.

To test Gemini TTS directly after the backend starts:

```bash
curl --fail -X POST http://127.0.0.1:8000/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello, welcome to SignSense."}' \
  --output /tmp/signsense-speech.wav
```

The endpoint returns `audio/wav`; missing keys return `503`, empty text returns `422`, invalid Google keys return `502`, quota limits return `429`, network/unavailable errors return `503`, and request timeouts return `504`.

Terminal 2 — frontend:

```bash
cd ~/Desktop/SignSense_CNN/frontend
cp -n .env.example .env
npm run dev
```

`frontend/.env.example` configures `VITE_BACKEND_URL`; change it in the local `frontend/.env` when the backend is hosted elsewhere. Open [http://localhost:5173](http://localhost:5173), allow camera access, click **Start camera**, then **Start recognition**. The header reports backend/model status. Camera frames are only sent while live recognition is running, and the WebSocket client reconnects after transient backend interruptions. The browser console logs connection, frame-send, and prediction milestones; backend logs include checkpoint/device status and periodic predictions.

## Webcam and image prediction

After training:

```bash
python main.py webcam
```

The webcam predicts from the entire frame (there is no hand detector or crop yet), displays the predicted class, confidence, and FPS, and labels low-confidence predictions as `Uncertain`. Exit with ESC or Q. Override the camera or model if needed:

```bash
python main.py webcam --camera-index 1 --checkpoint models/checkpoints/<checkpoint>.pth
```

For single-image inference, use `inference.predict.predict_image` from Python with the image path, checkpoint path, configured image size, and resolved device.

## Outputs

- `models/checkpoints/`: timestamped best checkpoints; existing checkpoint files are never overwritten. `best_model.json` points to the latest best checkpoint.
- `outputs/class_to_idx.json`: shared class-to-index mapping.
- `outputs/logs/`: pipeline log and training history.
- `outputs/plots/`: training/validation accuracy and loss plots.
- `outputs/predictions/`: metrics JSON, per-class CSV/chart, confusion matrix CSV/chart, misclassified image contact sheet and CSV.

The checkpoint contains model state, class mapping, model configuration, best validation metrics, training history, optimizer state, and training settings.

## Configuration

Edit `config/config.yaml` to change dataset root, image size, model, batch/workers, stage epoch limits and learning rates, weight decay, seed, device, early stopping, confidence threshold, camera index, and output paths. Supported model architecture names are `mobilenet_v3_small`, `mobilenet_v3_large`, `resnet18`, and `efficientnet_b0`.

## Troubleshooting

- **Dataset path or class error:** confirm each split has all 36 class directories and the symlink targets exist. The supplied participant split folders should remain unchanged.
- **Unreadable-image warning:** the listed images are excluded; inspect the original file/link if the count is unexpected.
- **Pretrained weights cannot be fetched:** ensure torchvision can access its official weights URL, or populate the standard torch model cache separately. Do not replace the supplied dataset or silently switch to random initialization for a production run.
- **Out of memory / very slow CPU:** lower batch size and worker count in YAML. This project supports CPU-only training but a full run can take substantial time.
- **Webcam unavailable:** check OS camera permissions, camera index, and that no other process has locked the device. OpenCV display requires a graphical desktop session.
- **Low validation or test performance:** check the reported class-level metrics and confusion matrix; do not infer success from training accuracy alone. The test participant is deliberately held out.

## Future integration into `~/Desktop/ASL`

This repository is intentionally separate and does not alter the original project. After validating a model, manually copy the desired checkpoint and class mapping into the original project's chosen model location, then implement an adapter that loads the checkpoint, applies the same RGB resize and ImageNet normalization, and maps output indices through the saved class mapping. Webcam inference currently classifies the full frame. Integrate hand detection/cropping and frontend/webcam changes separately and test them within the original project only when intentionally performing that later integration.
