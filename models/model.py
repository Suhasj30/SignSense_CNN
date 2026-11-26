"""Configurable torchvision transfer-learning models and checkpoint loading."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import torch
from torch import nn
from torchvision import models

LOGGER = logging.getLogger(__name__)

SUPPORTED_ARCHITECTURES = {
    "mobilenet_v3_small",
    "mobilenet_v3_large",
    "resnet18",
    "efficientnet_b0",
}


def build_model(
    architecture: str,
    num_classes: int,
    pretrained: bool = True,
) -> nn.Module:
    if architecture not in SUPPORTED_ARCHITECTURES:
        raise ValueError(
            f"Unsupported architecture '{architecture}'. "
            f"Choose from: {', '.join(sorted(SUPPORTED_ARCHITECTURES))}"
        )
    if num_classes <= 0:
        raise ValueError("num_classes must be a positive integer")

    constructors = {
        "mobilenet_v3_small": (
            models.mobilenet_v3_small,
            models.MobileNet_V3_Small_Weights.DEFAULT,
        ),
        "mobilenet_v3_large": (
            models.mobilenet_v3_large,
            models.MobileNet_V3_Large_Weights.DEFAULT,
        ),
        "resnet18": (models.resnet18, models.ResNet18_Weights.DEFAULT),
        "efficientnet_b0": (
            models.efficientnet_b0,
            models.EfficientNet_B0_Weights.DEFAULT,
        ),
    }
    constructor, weights = constructors[architecture]
    model = constructor(weights=weights if pretrained else None)

    if architecture.startswith("mobilenet_v3"):
        model.classifier[3] = nn.Linear(model.classifier[3].in_features, num_classes)
    elif architecture == "efficientnet_b0":
        model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
    else:
        model.fc = nn.Linear(model.fc.in_features, num_classes)
    return model


def configure_trainable_parameters(
    model: nn.Module,
    architecture: str,
    stage: str,
) -> list[nn.Parameter]:
    if stage not in {"head", "fine_tune"}:
        raise ValueError(f"Unknown training stage: {stage}")
    for parameter in model.parameters():
        parameter.requires_grad = False

    if architecture.startswith("mobilenet_v3"):
        head = model.classifier
        if stage == "head":
            trainable_modules = [head]
        else:
            trainable_modules = [model.features[-2:], head]
    elif architecture == "efficientnet_b0":
        head = model.classifier
        if stage == "head":
            trainable_modules = [head]
        else:
            trainable_modules = [model.features[-2:], head]
    elif architecture == "resnet18":
        head = model.fc
        if stage == "head":
            trainable_modules = [head]
        else:
            trainable_modules = [model.layer4, head]
    else:
        raise ValueError(f"Unsupported architecture '{architecture}'")

    for module in trainable_modules:
        for parameter in module.parameters():
            parameter.requires_grad = True
    trainable_parameters = [
        parameter for parameter in model.parameters() if parameter.requires_grad
    ]
    if not trainable_parameters:
        raise RuntimeError(f"No trainable parameters configured for {architecture} ({stage})")
    LOGGER.info(
        "%s stage: %d/%d parameters tensors are trainable",
        stage,
        len(trainable_parameters),
        sum(1 for _ in model.parameters()),
    )
    return trainable_parameters


def load_checkpoint_model(
    checkpoint_path: Path,
    device: torch.device,
) -> tuple[nn.Module, dict[str, Any]]:
    if not checkpoint_path.is_file():
        raise FileNotFoundError(f"Checkpoint does not exist: {checkpoint_path}")
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    required_keys = {"model_state_dict", "class_to_idx", "model_config"}
    missing = required_keys - checkpoint.keys()
    if missing:
        raise ValueError(f"Checkpoint is missing required fields: {sorted(missing)}")
    model_config = checkpoint["model_config"]
    model = build_model(
        architecture=model_config["architecture"],
        num_classes=len(checkpoint["class_to_idx"]),
        pretrained=False,
    )
    model.load_state_dict(checkpoint["model_state_dict"])
    model.to(device)
    model.eval()
    return model, checkpoint


def resolve_device(device_setting: str) -> torch.device:
    if device_setting == "auto":
        device_setting = "cuda" if torch.cuda.is_available() else "cpu"
    if device_setting == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is not available in this PyTorch environment")
    if device_setting not in {"cpu", "cuda"}:
        raise ValueError("device must be one of: auto, cpu, cuda")
    return torch.device(device_setting)
