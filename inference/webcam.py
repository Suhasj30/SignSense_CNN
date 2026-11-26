"""OpenCV full-frame webcam inference."""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

import cv2
import torch
from PIL import Image

from models.model import load_checkpoint_model, resolve_device
from training.dataset import build_transform

LOGGER = logging.getLogger(__name__)


def run_webcam(
    checkpoint_path: Path,
    config: dict[str, Any],
    camera_index: int | None = None,
) -> None:
    device = resolve_device(config["training"]["device"])
    model, checkpoint = load_checkpoint_model(checkpoint_path, device)
    idx_to_class = {index: name for name, index in checkpoint["class_to_idx"].items()}
    image_size = checkpoint["model_config"].get("image_size", config["data"]["image_size"])
    transform = build_transform(int(image_size))
    inference_config = config["inference"]
    threshold = float(inference_config["confidence_threshold"])
    camera = int(inference_config["camera_index"] if camera_index is None else camera_index)
    capture = cv2.VideoCapture(camera)
    if not capture.isOpened():
        capture.release()
        raise RuntimeError(
            f"Could not open webcam index {camera}. Check camera access and configuration."
        )

    previous_time = time.perf_counter()
    smoothed_fps = 0.0
    LOGGER.info("Webcam ready. Press ESC or Q to exit.")
    try:
        while True:
            success, frame = capture.read()
            if not success:
                raise RuntimeError("Could not read a frame from the webcam")
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            tensor = transform(Image.fromarray(rgb_frame)).unsqueeze(0).to(device)
            with torch.inference_mode():
                probabilities = torch.softmax(model(tensor), dim=1)[0]
            confidence, predicted_index = probabilities.max(dim=0)
            confidence_value = confidence.item()
            label = (
                idx_to_class[predicted_index.item()]
                if confidence_value >= threshold
                else "Uncertain"
            )
            now = time.perf_counter()
            instantaneous_fps = 1.0 / max(now - previous_time, 1e-8)
            previous_time = now
            smoothed_fps = (
                instantaneous_fps
                if smoothed_fps == 0
                else 0.9 * smoothed_fps + 0.1 * instantaneous_fps
            )

            cv2.putText(
                frame,
                f"Prediction: {label}",
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                (0, 255, 0),
                2,
            )
            cv2.putText(
                frame,
                f"Confidence: {confidence_value:.1%}  FPS: {smoothed_fps:.1f}",
                (20, 80),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 0),
                2,
            )
            cv2.imshow("SignSense CNN - full-frame prediction", frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord("q"), ord("Q")):
                break
    finally:
        capture.release()
        cv2.destroyAllWindows()
