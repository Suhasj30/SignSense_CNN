"""Dataset discovery, validation, transforms, and DataLoader construction."""

from __future__ import annotations

import json
import logging
import random
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image, UnidentifiedImageError
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms

LOGGER = logging.getLogger(__name__)
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


class SignDataset(Dataset[tuple[torch.Tensor, int, str]]):
    """ImageFolder-style dataset that verifies and reports unreadable images."""

    def __init__(
        self,
        split_dir: Path,
        class_to_idx: dict[str, int],
        transform: transforms.Compose,
        validate_images: bool = True,
    ) -> None:
        self.split_dir = split_dir
        self.class_to_idx = class_to_idx
        self.transform = transform
        self.samples: list[tuple[Path, int]] = []
        unreadable: list[Path] = []

        if not split_dir.is_dir():
            raise FileNotFoundError(f"Dataset split directory does not exist: {split_dir}")

        for class_name, class_index in class_to_idx.items():
            class_dir = split_dir / class_name
            if not class_dir.is_dir():
                raise ValueError(f"Missing class directory '{class_name}' in {split_dir}")
            for path in sorted(class_dir.iterdir()):
                if path.suffix.lower() not in IMAGE_EXTENSIONS or not path.is_file():
                    continue
                if validate_images and not self._is_readable(path):
                    unreadable.append(path)
                    continue
                self.samples.append((path, class_index))

        if unreadable:
            LOGGER.warning(
                "Excluded %d unreadable image(s) from %s. First paths: %s",
                len(unreadable),
                split_dir,
                ", ".join(str(path) for path in unreadable[:10]),
            )
        if not self.samples:
            raise ValueError(f"No readable images found in dataset split: {split_dir}")

    @staticmethod
    def _is_readable(path: Path) -> bool:
        try:
            with Image.open(path) as image:
                image.verify()
        except (OSError, SyntaxError, ValueError, UnidentifiedImageError):
            return False
        return True

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, int, str]:
        path, target = self.samples[index]
        try:
            with Image.open(path) as image:
                rgb_image = image.convert("RGB")
        except (OSError, SyntaxError, ValueError, UnidentifiedImageError) as error:
            raise RuntimeError(
                f"Image became unreadable after dataset validation: {path}"
            ) from error
        return self.transform(rgb_image), target, str(path)


def build_transform(image_size: int, training: bool = False) -> transforms.Compose:
    """Build the shared RGB/ImageNet preprocessing pipeline."""
    operations: list[Any] = [transforms.Resize((image_size, image_size))]
    if training:
        operations.extend(
            [
                transforms.RandomAffine(
                    degrees=8,
                    translate=(0.04, 0.04),
                    scale=(0.95, 1.05),
                    fill=(0, 0, 0),
                ),
                transforms.ColorJitter(brightness=0.12, contrast=0.12),
            ]
        )
    operations.extend(
        [
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )
    return transforms.Compose(operations)


def discover_class_mapping(train_dir: Path, expected_num_classes: int) -> dict[str, int]:
    if not train_dir.is_dir():
        raise FileNotFoundError(f"Training split directory does not exist: {train_dir}")
    class_names = sorted(path.name for path in train_dir.iterdir() if path.is_dir())
    if len(class_names) != expected_num_classes:
        raise ValueError(
            f"Expected {expected_num_classes} class directories in {train_dir}, "
            f"found {len(class_names)}: {class_names}"
        )
    return {class_name: index for index, class_name in enumerate(class_names)}


def _validate_split_classes(split_dir: Path, class_to_idx: dict[str, int]) -> None:
    if not split_dir.is_dir():
        raise FileNotFoundError(f"Dataset split directory does not exist: {split_dir}")
    found = {path.name for path in split_dir.iterdir() if path.is_dir()}
    expected = set(class_to_idx)
    if found != expected:
        raise ValueError(
            f"Class directories in {split_dir} do not match training mapping. "
            f"Missing: {sorted(expected - found)}; unexpected: {sorted(found - expected)}"
        )


def _seed_worker(worker_id: int) -> None:
    worker_seed = torch.initial_seed() % (2**32)
    np.random.seed(worker_seed)
    random.seed(worker_seed)


def create_dataloaders(
    config: dict[str, Any],
    project_root: Path,
    device: torch.device,
) -> tuple[dict[str, DataLoader], dict[str, int]]:
    data_config = config["data"]
    dataset_root = Path(data_config["dataset_root"]).expanduser()
    if not dataset_root.is_absolute():
        dataset_root = (project_root / dataset_root).resolve()
    expected_classes = int(data_config["num_classes"])
    class_to_idx = discover_class_mapping(
        dataset_root / "train", expected_num_classes=expected_classes
    )

    mapping_path = project_root / "outputs" / "class_to_idx.json"
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    mapping_path.write_text(json.dumps(class_to_idx, indent=2) + "\n", encoding="utf-8")

    batch_size = int(config["training"]["batch_size"])
    num_workers = int(config["training"]["num_workers"])
    image_size = int(data_config["image_size"])
    pin_memory = device.type == "cuda"
    loaders: dict[str, DataLoader] = {}

    for split in ("train", "val", "test"):
        split_dir = dataset_root / split
        _validate_split_classes(split_dir, class_to_idx)
        dataset = SignDataset(
            split_dir=split_dir,
            class_to_idx=class_to_idx,
            transform=build_transform(image_size, training=(split == "train")),
        )
        generator = torch.Generator()
        generator.manual_seed(int(config["training"]["seed"]))
        loaders[split] = DataLoader(
            dataset,
            batch_size=batch_size,
            shuffle=(split == "train"),
            num_workers=num_workers,
            pin_memory=pin_memory,
            persistent_workers=(num_workers > 0),
            worker_init_fn=_seed_worker,
            generator=generator,
        )
        LOGGER.info(
            "%s: %d readable images across %d classes",
            split,
            len(dataset),
            len(class_to_idx),
        )

    LOGGER.info("Saved class mapping to %s", mapping_path)
    return loaders, class_to_idx


def create_split_loader(
    config: dict[str, Any],
    split: str,
    class_to_idx: dict[str, int],
    project_root: Path,
    device: torch.device,
) -> DataLoader:
    if split not in {"train", "val", "test"}:
        raise ValueError(f"Unsupported dataset split: {split}")
    data_config = config["data"]
    dataset_root = Path(data_config["dataset_root"]).expanduser()
    if not dataset_root.is_absolute():
        dataset_root = (project_root / dataset_root).resolve()
    split_dir = dataset_root / split
    _validate_split_classes(split_dir, class_to_idx)
    dataset = SignDataset(
        split_dir,
        class_to_idx,
        build_transform(int(data_config["image_size"]), training=False),
    )
    batch_size = int(config["training"]["batch_size"])
    num_workers = int(config["training"]["num_workers"])
    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=(device.type == "cuda"),
        persistent_workers=(num_workers > 0),
    )
