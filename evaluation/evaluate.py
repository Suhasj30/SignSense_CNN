"""Final test-set evaluation for a saved best-validation checkpoint."""

from __future__ import annotations

import csv
import json
import logging
from pathlib import Path
from typing import Any

import torch
from sklearn.metrics import precision_recall_fscore_support
from tqdm import tqdm

from evaluation.confusion_matrix import create_confusion_matrix
from evaluation.visualize import save_misclassified_samples, write_per_class_metrics
from models.model import load_checkpoint_model, resolve_device
from training.dataset import create_split_loader

LOGGER = logging.getLogger(__name__)


def evaluate_checkpoint(
    checkpoint_path: Path,
    config: dict[str, Any],
    project_root: Path,
) -> dict[str, Any]:
    device = resolve_device(config["training"]["device"])
    model, checkpoint = load_checkpoint_model(checkpoint_path, device)
    class_to_idx: dict[str, int] = checkpoint["class_to_idx"]
    class_names = [name for name, _index in sorted(class_to_idx.items(), key=lambda item: item[1])]
    evaluation_config = {
        **config,
        "data": {
            **config["data"],
            "image_size": checkpoint["model_config"].get(
                "image_size", config["data"]["image_size"]
            ),
        },
    }
    loader = create_split_loader(evaluation_config, "test", class_to_idx, project_root, device)
    targets: list[int] = []
    predictions: list[int] = []
    records: list[dict[str, Any]] = []

    with torch.inference_mode():
        for images, labels, paths in tqdm(loader, desc="Final test evaluation"):
            logits = model(images.to(device, non_blocking=(device.type == "cuda")))
            probabilities = torch.softmax(logits, dim=1)
            top1 = probabilities.argmax(dim=1).cpu()
            top3 = probabilities.topk(k=min(3, len(class_names)), dim=1).indices.cpu()
            labels_cpu = labels.cpu()
            targets.extend(labels_cpu.tolist())
            predictions.extend(top1.tolist())
            confidence_values = probabilities.max(dim=1).values.cpu().tolist()
            for index, path in enumerate(paths):
                records.append(
                    {
                        "path": path,
                        "actual": class_names[labels_cpu[index].item()],
                        "predicted": class_names[top1[index].item()],
                        "confidence": confidence_values[index],
                        "top3_correct": int(labels_cpu[index].item() in top3[index].tolist()),
                    }
                )

    if not targets:
        raise RuntimeError("The test DataLoader yielded no samples")

    class_indices = list(range(len(class_names)))
    precision, recall, f1_score, support = precision_recall_fscore_support(
        targets,
        predictions,
        labels=class_indices,
        zero_division=0,
    )
    accuracy = (
        sum(actual == predicted for actual, predicted in zip(targets, predictions))
        / len(targets)
    )
    top3_accuracy = sum(record["top3_correct"] for record in records) / len(records)

    output_dir = project_root / config["paths"]["prediction_dir"]
    output_dir.mkdir(parents=True, exist_ok=True)
    matrix = create_confusion_matrix(targets, predictions, class_names, output_dir)
    write_per_class_metrics(
        class_names,
        precision.tolist(),
        recall.tolist(),
        f1_score.tolist(),
        support.astype(int).tolist(),
        output_dir,
    )
    with (output_dir / "misclassified_samples.csv").open(
        "w", newline="", encoding="utf-8"
    ) as file:
        writer = csv.DictWriter(file, fieldnames=("path", "actual", "predicted", "confidence"))
        writer.writeheader()
        writer.writerows(
            {
                "path": record["path"],
                "actual": record["actual"],
                "predicted": record["predicted"],
                "confidence": record["confidence"],
            }
            for record in records
            if record["actual"] != record["predicted"]
        )
    save_misclassified_samples(
        records,
        output_dir,
        int(config["evaluation"]["max_misclassified_samples"]),
    )

    focused_confusions: dict[str, dict[str, int]] = {}
    for left, right in (("M", "N"), ("U", "V"), ("O", "0"), ("I", "1")):
        left_index, right_index = class_to_idx[left], class_to_idx[right]
        focused_confusions[f"{left}/{right}"] = {
            f"{left}_predicted_as_{right}": int(matrix[left_index, right_index]),
            f"{right}_predicted_as_{left}": int(matrix[right_index, left_index]),
        }

    metrics: dict[str, Any] = {
        "checkpoint": str(checkpoint_path),
        "test_samples": len(targets),
        "test_accuracy": accuracy,
        "top1_accuracy": accuracy,
        "top3_accuracy": top3_accuracy,
        "macro_average": {
            "precision": float(precision.mean()),
            "recall": float(recall.mean()),
            "f1_score": float(f1_score.mean()),
        },
        "weighted_average": {
            "precision": float((precision * support).sum() / support.sum()),
            "recall": float((recall * support).sum() / support.sum()),
            "f1_score": float((f1_score * support).sum() / support.sum()),
        },
        "per_class": {
            class_name: {
                "precision": float(precision[index]),
                "recall": float(recall[index]),
                "f1_score": float(f1_score[index]),
                "support": int(support[index]),
            }
            for index, class_name in enumerate(class_names)
        },
        "focused_confusions": focused_confusions,
        "unseen_signer_note": (
            "The test split uses participant P10, separate from training participants P1-P7 "
            "and validation participants P8-P9. These results measure generalization to an "
            "unseen signer."
        ),
    }
    metrics_path = output_dir / "test_metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    LOGGER.info("Test accuracy / top-1: %.4f; top-3: %.4f", accuracy, top3_accuracy)
    LOGGER.info(
        "Macro F1: %.4f; weighted F1: %.4f",
        metrics["macro_average"]["f1_score"],
        metrics["weighted_average"]["f1_score"],
    )
    for class_name, class_metrics in metrics["per_class"].items():
        LOGGER.info(
            "%s precision %.4f recall %.4f F1 %.4f (n=%d)",
            class_name,
            class_metrics["precision"],
            class_metrics["recall"],
            class_metrics["f1_score"],
            class_metrics["support"],
        )
    LOGGER.info("Focused confusions: %s", focused_confusions)
    LOGGER.info("Test metrics and visualizations saved in %s", output_dir)
    return metrics
