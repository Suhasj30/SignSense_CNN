"""FastAPI WebSocket service for real-time SignSense predictions."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Any

import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from models.model import load_checkpoint_model
from training.dataset import build_transform

LOGGER = logging.getLogger("signsense.backend")
LOGGER.setLevel(logging.INFO)
if not LOGGER.handlers:
    log_handler = logging.StreamHandler()
    log_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    LOGGER.addHandler(log_handler)
LOGGER.propagate = False
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CHECKPOINT = (
    PROJECT_ROOT
    / "models"
    / "checkpoints"
    / "mobilenet_v3_small_best_20261126_100259.pth"
)
MAX_FRAME_BYTES = 4 * 1024 * 1024
MAX_FRAME_PIXELS = 16_777_216
EXPECTED_CLASS_TO_IDX = {
    **{str(number): number for number in range(10)},
    **{chr(ord("A") + offset): 10 + offset for offset in range(26)},
}
DEFAULT_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")


def _configured_origins() -> list[str]:
    configured = os.environ.get("SIGNSENSE_CORS_ORIGINS")
    if configured is None:
        return list(DEFAULT_ORIGINS)
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


class InvalidFrameError(ValueError):
    """Raised when an incoming WebSocket frame is invalid or unsupported."""


class InferenceRuntime:
    def __init__(self, checkpoint_path: Path) -> None:
        thread_count = int(
            os.environ.get("SIGNSENSE_TORCH_THREADS", str(min(2, os.cpu_count() or 1)))
        )
        if thread_count < 1:
            raise ValueError("SIGNSENSE_TORCH_THREADS must be at least 1")
        torch.set_num_threads(thread_count)

        model, checkpoint = load_checkpoint_model(checkpoint_path, torch.device("cpu"))
        raw_mapping = checkpoint["class_to_idx"]
        class_to_idx = {str(name): int(index) for name, index in raw_mapping.items()}
        if class_to_idx != EXPECTED_CLASS_TO_IDX:
            raise ValueError(
                "Checkpoint class mapping must be digits 0-9 followed by letters A-Z "
                "with indices 0-35"
            )
        model_config = checkpoint["model_config"]
        image_size = int(model_config["image_size"])

        self.model = model
        self.architecture = str(model_config["architecture"])
        self.idx_to_class = {index: name for name, index in class_to_idx.items()}
        self.transform = build_transform(image_size)
        self.image_size = image_size
        self.inference_lock = threading.Lock()

    def predict(self, frame_bytes: bytes) -> dict[str, Any]:
        if not frame_bytes:
            raise InvalidFrameError("Frame is empty.")
        if len(frame_bytes) > MAX_FRAME_BYTES:
            raise InvalidFrameError("Frame exceeds the 4 MiB size limit.")

        try:
            with Image.open(BytesIO(frame_bytes)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise InvalidFrameError("Frame must be a JPEG, PNG, or WebP image.")
                width, height = image.size
                if width < 1 or height < 1 or width * height > MAX_FRAME_PIXELS:
                    raise InvalidFrameError("Frame dimensions are invalid or too large.")
                rgb_image = image.convert("RGB")
        except InvalidFrameError:
            raise
        except (
            OSError,
            SyntaxError,
            ValueError,
            UnidentifiedImageError,
            Image.DecompressionBombError,
        ) as error:
            raise InvalidFrameError("Could not decode image frame.") from error

        tensor = self.transform(rgb_image).unsqueeze(0)
        with self.inference_lock, torch.inference_mode():
            logits = self.model(tensor)
            expected_shape = (1, len(self.idx_to_class))
            if tuple(logits.shape) != expected_shape:
                raise RuntimeError(
                    f"Model returned output shape {tuple(logits.shape)}; "
                    f"expected {expected_shape}."
                )
            if not torch.isfinite(logits).all():
                raise RuntimeError("The model returned non-finite logits.")
            probabilities = torch.softmax(logits, dim=1)[0]
        if not torch.isfinite(probabilities).all():
            raise RuntimeError("The model returned non-finite probabilities.")
        confidence, predicted_index = probabilities.max(dim=0)
        confidence_value = float(confidence.item())
        return {
            "class": self.idx_to_class[int(predicted_index.item())],
            "confidence": confidence_value,
        }


@asynccontextmanager
async def lifespan(app: FastAPI):
    checkpoint_path = Path(
        os.environ.get("SIGNSENSE_CHECKPOINT", str(DEFAULT_CHECKPOINT))
    ).expanduser()
    if not checkpoint_path.is_absolute():
        checkpoint_path = PROJECT_ROOT / checkpoint_path
    checkpoint_path = checkpoint_path.resolve()

    LOGGER.info("Loading checkpoint from %s on CPU", checkpoint_path)
    try:
        app.state.runtime = InferenceRuntime(checkpoint_path)
    except Exception:
        LOGGER.exception("Failed to load inference checkpoint from %s", checkpoint_path)
        raise
    LOGGER.info(
        "Model loaded: architecture=%s classes=%d image_size=%d eval=%s",
        app.state.runtime.architecture,
        len(app.state.runtime.idx_to_class),
        app.state.runtime.image_size,
        not app.state.runtime.model.training,
    )
    try:
        yield
    finally:
        app.state.runtime = None


app = FastAPI(title="SignSense Inference API", lifespan=lifespan)
app.state.allowed_origins = _configured_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=app.state.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    runtime = getattr(app.state, "runtime", None)
    return {
        "status": "ok" if runtime is not None else "unavailable",
        "model_loaded": runtime is not None,
        "device": "cpu",
        "num_classes": len(runtime.idx_to_class) if runtime is not None else 0,
    }


@app.websocket("/ws/predict")
async def predict_frames(websocket: WebSocket) -> None:
    origin = websocket.headers.get("origin")
    if origin and origin not in app.state.allowed_origins:
        LOGGER.warning("Rejected WebSocket client with disallowed origin %s", origin)
        await websocket.close(code=1008, reason="Origin is not allowed.")
        return

    runtime: InferenceRuntime | None = getattr(app.state, "runtime", None)
    if runtime is None:
        LOGGER.error("Rejected WebSocket client because the inference model is unavailable")
        await websocket.close(code=1011, reason="Inference model is unavailable.")
        return

    await websocket.accept()
    processed_frames = 0
    LOGGER.info("WebSocket client connected: origin=%s", origin or "not provided")
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            frame_bytes = message.get("bytes")
            if frame_bytes is None:
                await websocket.send_json({"error": "Send image frames as binary data."})
                continue

            try:
                result = await run_in_threadpool(runtime.predict, frame_bytes)
            except InvalidFrameError as error:
                LOGGER.warning("Rejected invalid WebSocket frame: %s", error)
                await websocket.send_json({"error": str(error)})
                continue
            except Exception:
                LOGGER.exception("Inference failed for a WebSocket frame")
                await websocket.send_json(
                    {"error": "Inference failed. Check the backend logs."}
                )
                continue
            await websocket.send_json(result)
            processed_frames += 1
            if processed_frames == 1 or processed_frames % 20 == 0:
                LOGGER.info(
                    "Processed frame %d: bytes=%d prediction=%s confidence=%.3f",
                    processed_frames,
                    len(frame_bytes),
                    result["class"],
                    result["confidence"],
                )
    except WebSocketDisconnect:
        LOGGER.info("WebSocket client disconnected after %d processed frame(s)", processed_frames)
    except asyncio.CancelledError:
        raise
