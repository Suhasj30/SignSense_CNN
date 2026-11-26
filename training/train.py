"""Training workflow entry point used by main.py."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from models.model import build_model, resolve_device
from training.dataset import create_dataloaders
from training.trainer import seed_everything, train_model

LOGGER = logging.getLogger(__name__)


def run_training(config: dict[str, Any], project_root: Path) -> Path:
    seed_everything(int(config["training"]["seed"]))
    device = resolve_device(config["training"]["device"])
    LOGGER.info("Training device: %s", device)
    loaders, class_to_idx = create_dataloaders(config, project_root, device)
    model = build_model(
        architecture=config["model"]["architecture"],
        num_classes=len(class_to_idx),
        pretrained=bool(config["model"]["pretrained"]),
    )
    checkpoint_path, _history, _best_accuracy = train_model(
        model=model,
        loaders=loaders,
        class_to_idx=class_to_idx,
        config=config,
        project_root=project_root,
        device=device,
    )
    return checkpoint_path
