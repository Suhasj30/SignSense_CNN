"""Two-stage transfer learning and fine-tuning loop."""

from __future__ import annotations

import json
import logging
import random
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn
from torch.optim import Adam
from torch.optim.lr_scheduler import ReduceLROnPlateau
from torch.utils.data import DataLoader
from tqdm import tqdm

from models.model import configure_trainable_parameters

LOGGER = logging.getLogger(__name__)


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _run_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
    optimizer: torch.optim.Optimizer | None,
    description: str,
) -> tuple[float, float]:
    training = optimizer is not None
    model.train(training)
    if training:
        for module in model.modules():
            if isinstance(module, nn.modules.batchnorm._BatchNorm) and not any(
                parameter.requires_grad for parameter in module.parameters()
            ):
                module.eval()
    total_loss = 0.0
    total_correct = 0
    total_samples = 0
    context = torch.enable_grad() if training else torch.inference_mode()

    with context:
        progress = tqdm(loader, desc=description, leave=False)
        for images, labels, _paths in progress:
            images = images.to(device, non_blocking=(device.type == "cuda"))
            labels = labels.to(device, non_blocking=(device.type == "cuda"))
            if optimizer is not None:
                optimizer.zero_grad(set_to_none=True)
            logits = model(images)
            loss = criterion(logits, labels)
            if optimizer is not None:
                loss.backward()
                optimizer.step()

            batch_size = labels.size(0)
            total_loss += loss.item() * batch_size
            total_correct += (logits.argmax(dim=1) == labels).sum().item()
            total_samples += batch_size
            progress.set_postfix(loss=f"{loss.item():.4f}")

    if total_samples == 0:
        raise RuntimeError(f"No samples were processed during {description}")
    return total_loss / total_samples, total_correct / total_samples


def _new_checkpoint_path(checkpoint_dir: Path, architecture: str) -> Path:
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    candidate = checkpoint_dir / f"{architecture}_best_{timestamp}.pth"
    suffix = 1
    while candidate.exists():
        candidate = checkpoint_dir / f"{architecture}_best_{timestamp}_{suffix}.pth"
        suffix += 1
    LOGGER.info("Checkpoint will be saved without overwriting existing files: %s", candidate)
    return candidate


def train_model(
    model: nn.Module,
    loaders: dict[str, DataLoader],
    class_to_idx: dict[str, int],
    config: dict[str, Any],
    project_root: Path,
    device: torch.device,
) -> tuple[Path, list[dict[str, Any]], float]:
    training_config = config["training"]
    model_config = config["model"]
    seed_everything(int(training_config["seed"]))
    model.to(device)
    criterion = nn.CrossEntropyLoss()
    checkpoint_dir = project_root / config["paths"]["checkpoint_dir"]
    checkpoint_path = _new_checkpoint_path(checkpoint_dir, model_config["architecture"])
    history: list[dict[str, Any]] = []
    best_validation_accuracy = -1.0
    best_validation_loss = float("inf")
    best_epoch: dict[str, Any] = {}
    patience = int(training_config["early_stopping_patience"])
    min_delta = float(training_config["early_stopping_min_delta"])

    stages = (
        (
            "head",
            int(training_config["stage1_epochs"]),
            float(training_config["stage1_learning_rate"]),
        ),
        (
            "fine_tune",
            int(training_config["stage2_epochs"]),
            float(training_config["stage2_learning_rate"]),
        ),
    )
    for stage_name, max_epochs, learning_rate in stages:
        if max_epochs <= 0:
            LOGGER.info("Skipping %s stage because its epoch limit is zero", stage_name)
            continue
        parameters = configure_trainable_parameters(model, model_config["architecture"], stage_name)
        optimizer = Adam(
            parameters,
            lr=learning_rate,
            weight_decay=float(training_config["weight_decay"]),
        )
        scheduler = ReduceLROnPlateau(
            optimizer,
            mode="min",
            factor=float(training_config["scheduler_factor"]),
            patience=max(1, patience // 2),
        )
        stage_best_accuracy = -1.0
        epochs_without_improvement = 0

        for epoch in range(1, max_epochs + 1):
            train_loss, train_accuracy = _run_epoch(
                model,
                loaders["train"],
                criterion,
                device,
                optimizer,
                f"{stage_name} {epoch}/{max_epochs} train",
            )
            validation_loss, validation_accuracy = _run_epoch(
                model,
                loaders["val"],
                criterion,
                device,
                None,
                f"{stage_name} {epoch}/{max_epochs} val",
            )
            scheduler.step(validation_loss)
            learning_rate_now = optimizer.param_groups[0]["lr"]
            epoch_result = {
                "stage": stage_name,
                "epoch": epoch,
                "train_loss": train_loss,
                "train_accuracy": train_accuracy,
                "validation_loss": validation_loss,
                "validation_accuracy": validation_accuracy,
                "learning_rate": learning_rate_now,
            }
            history.append(epoch_result)
            LOGGER.info(
                "%s epoch %d/%d | train loss %.4f acc %.4f | "
                "val loss %.4f acc %.4f | lr %.2g",
                stage_name,
                epoch,
                max_epochs,
                train_loss,
                train_accuracy,
                validation_loss,
                validation_accuracy,
                learning_rate_now,
            )

            improved_stage = validation_accuracy > stage_best_accuracy + min_delta
            if improved_stage:
                stage_best_accuracy = validation_accuracy
                epochs_without_improvement = 0
            else:
                epochs_without_improvement += 1

            if validation_accuracy > best_validation_accuracy:
                best_validation_accuracy = validation_accuracy
                best_validation_loss = validation_loss
                best_epoch = {"stage": stage_name, "epoch": epoch}
                checkpoint = {
                    "model_state_dict": model.state_dict(),
                    "class_to_idx": class_to_idx,
                    "model_config": {
                        "architecture": model_config["architecture"],
                        "image_size": config["data"]["image_size"],
                    },
                    "best_validation_accuracy": best_validation_accuracy,
                    "best_validation_loss": best_validation_loss,
                    "best_epoch": best_epoch,
                    "training_history": history.copy(),
                    "optimizer_state_dict": optimizer.state_dict(),
                    "training_config": training_config.copy(),
                }
                torch.save(checkpoint, checkpoint_path)
                manifest = checkpoint_dir / "best_model.json"
                manifest.write_text(
                    json.dumps(
                        {
                            "checkpoint": checkpoint_path.name,
                            "best_validation_accuracy": best_validation_accuracy,
                            "best_epoch": best_epoch,
                        },
                        indent=2,
                    )
                    + "\n",
                    encoding="utf-8",
                )
                LOGGER.info("Saved new best validation checkpoint: %s", checkpoint_path)

            if epochs_without_improvement >= patience:
                LOGGER.info(
                    "Early stopping %s stage after %d epoch(s) without "
                    "validation accuracy improvement",
                    stage_name,
                    epochs_without_improvement,
                )
                break

    if best_validation_accuracy < 0:
        raise RuntimeError("Training completed without saving a validation checkpoint")

    history_path = project_root / config["paths"]["log_dir"] / "training_history.json"
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history_path.write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")
    best_checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    best_checkpoint["training_history"] = history
    torch.save(best_checkpoint, checkpoint_path)
    LOGGER.info(
        "Best validation accuracy %.4f at %s; checkpoint: %s",
        best_validation_accuracy,
        best_epoch,
        checkpoint_path,
    )
    return checkpoint_path, history, best_validation_accuracy
