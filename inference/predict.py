"""Single-image CNN prediction helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import torch
from PIL import Image, UnidentifiedImageError

from models.model import load_checkpoint_model
from training.dataset import build_transform


def predict_image(
    image_path: Path,
    checkpoint_path: Path,
    image_size: int | None,
    device: torch.device,
) -> dict[str, Any]:
    if not image_path.is_file():
        raise FileNotFoundError(f"Image does not exist: {image_path}")
    model, checkpoint = load_checkpoint_model(checkpoint_path, device)
    try:
        with Image.open(image_path) as image:
            rgb_image = image.convert("RGB")
    except (OSError, SyntaxError, ValueError, UnidentifiedImageError) as error:
        raise ValueError(f"Could not read image: {image_path}") from error

    configured_size = checkpoint["model_config"].get("image_size", image_size)
    if configured_size is None:
        raise ValueError("image_size is required when the checkpoint does not record it")
    tensor = build_transform(int(configured_size))(rgb_image).unsqueeze(0).to(device)
    class_to_idx = checkpoint["class_to_idx"]
    idx_to_class = {index: name for name, index in class_to_idx.items()}
    with torch.inference_mode():
        probabilities = torch.softmax(model(tensor), dim=1)[0]
    confidence, predicted_index = probabilities.max(dim=0)
    return {
        "class": idx_to_class[predicted_index.item()],
        "confidence": confidence.item(),
        "probabilities": {
            idx_to_class[index]: float(probabilities[index].item())
            for index in range(probabilities.numel())
        },
    }
