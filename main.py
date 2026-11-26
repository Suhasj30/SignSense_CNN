"""Command-line entry point for SignSense CNN development."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

import torch
import yaml

from evaluation.evaluate import evaluate_checkpoint
from evaluation.visualize import plot_training_history
from inference.webcam import run_webcam
from models.model import build_model, resolve_device
from training.dataset import create_dataloaders
from training.train import run_training
from training.trainer import seed_everything

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = PROJECT_ROOT / "config" / "config.yaml"
LOGGER = logging.getLogger("signsense")


def load_config(config_path: Path) -> dict[str, Any]:
    if not config_path.is_file():
        raise FileNotFoundError(f"Configuration file does not exist: {config_path}")
    with config_path.open(encoding="utf-8") as file:
        config = yaml.safe_load(file)
    if not isinstance(config, dict):
        raise ValueError(f"Configuration must contain a YAML mapping: {config_path}")
    return config


def configure_logging(config: dict[str, Any]) -> None:
    log_dir = PROJECT_ROOT / config["paths"]["log_dir"]
    log_dir.mkdir(parents=True, exist_ok=True)
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    handlers.append(logging.FileHandler(log_dir / "pipeline.log", encoding="utf-8"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=handlers,
        force=True,
    )


def resolve_checkpoint(project_root: Path, requested: str | None) -> Path:
    if requested:
        path = Path(requested).expanduser()
        return path.resolve() if path.is_absolute() else (project_root / path).resolve()
    manifest_path = project_root / "models" / "checkpoints" / "best_model.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(
            f"No best-model manifest found at {manifest_path}. "
            "Train a model first or pass --checkpoint."
        )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    checkpoint = manifest_path.parent / manifest["checkpoint"]
    if not checkpoint.is_file():
        raise FileNotFoundError(
            f"Checkpoint referenced by {manifest_path} is missing: {checkpoint}"
        )
    return checkpoint


def run_preflight(config: dict[str, Any]) -> None:
    seed_everything(int(config["training"]["seed"]))
    device = resolve_device(config["training"]["device"])
    LOGGER.info("Running preflight on %s; no training will be started", device)
    loaders, class_to_idx = create_dataloaders(config, PROJECT_ROOT, device)
    if len(class_to_idx) != int(config["data"]["num_classes"]):
        raise RuntimeError(
            f"Detected {len(class_to_idx)} classes, expected {config['data']['num_classes']}"
        )
    forward_images: torch.Tensor | None = None
    for split in ("train", "val", "test"):
        batch = next(iter(loaders[split]), None)
        if batch is None:
            raise RuntimeError(f"{split} DataLoader produced no batch")
        images, labels, paths = batch
        if split == "train":
            forward_images = images
        LOGGER.info(
            "%s batch: images=%s labels=%s sample=%s",
            split,
            tuple(images.shape),
            tuple(labels.shape),
            paths[0],
        )
    if forward_images is None:
        raise RuntimeError("Training DataLoader did not provide an input batch")
    model = build_model(
        config["model"]["architecture"],
        len(class_to_idx),
        pretrained=bool(config["model"]["pretrained"]),
    ).to(device)
    model.eval()
    with torch.inference_mode():
        logits = model(forward_images[:1].to(device))
    expected_shape = (1, len(class_to_idx))
    if tuple(logits.shape) != expected_shape:
        raise RuntimeError(f"Expected model logits {expected_shape}, got {tuple(logits.shape)}")
    LOGGER.info(
        "Preflight passed: %d consistent classes, all split loaders returned a batch, "
        "model logits shape=%s",
        len(class_to_idx),
        tuple(logits.shape),
    )
    LOGGER.info("No training or test-set evaluation has been run.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SignSense CNN training and inference")
    parser.add_argument(
        "--config", type=Path, default=DEFAULT_CONFIG, help="YAML configuration file"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("validate", help="Check data, class mapping, batches, and model output")
    subparsers.add_parser("train", help="Train the two-stage transfer-learning model")
    evaluate_parser = subparsers.add_parser(
        "evaluate", help="Evaluate a saved checkpoint on test data"
    )
    evaluate_parser.add_argument(
        "--checkpoint", help="Checkpoint path (defaults to latest best model)"
    )
    webcam_parser = subparsers.add_parser("webcam", help="Run full-frame webcam inference")
    webcam_parser.add_argument(
        "--checkpoint", help="Checkpoint path (defaults to latest best model)"
    )
    webcam_parser.add_argument("--camera-index", type=int, help="OpenCV camera index override")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = load_config(args.config.expanduser().resolve())
    configure_logging(config)

    if args.command == "validate":
        run_preflight(config)
    elif args.command == "train":
        checkpoint = run_training(config, PROJECT_ROOT)
        plot_training_history(
            json.loads(
                (PROJECT_ROOT / config["paths"]["log_dir"] / "training_history.json").read_text(
                    encoding="utf-8"
                )
            ),
            PROJECT_ROOT / config["paths"]["plot_dir"],
        )
        LOGGER.info("Training finished. Starting the single final test-set evaluation.")
        evaluate_checkpoint(checkpoint, config, PROJECT_ROOT)
    elif args.command == "evaluate":
        evaluate_checkpoint(resolve_checkpoint(PROJECT_ROOT, args.checkpoint), config, PROJECT_ROOT)
    elif args.command == "webcam":
        run_webcam(
            resolve_checkpoint(PROJECT_ROOT, args.checkpoint),
            config,
            camera_index=args.camera_index,
        )


if __name__ == "__main__":
    main()
