"""Training history, class-metric, and error-sample plots."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
from PIL import Image


def plot_training_history(history: list[dict[str, Any]], output_dir: Path) -> None:
    if not history:
        raise ValueError("Training history is empty; cannot create training plots")
    output_dir.mkdir(parents=True, exist_ok=True)
    labels = [f"{entry['stage']}:{entry['epoch']}" for entry in history]
    positions = range(1, len(history) + 1)

    for metric, title, filename, ylabel in (
        ("accuracy", "Training and validation accuracy", "accuracy.png", "Accuracy"),
        ("loss", "Training and validation loss", "loss.png", "Loss"),
    ):
        figure, axis = plt.subplots(figsize=(11, 5))
        axis.plot(
            positions,
            [entry[f"train_{metric}"] for entry in history],
            marker="o",
            label="Training",
        )
        axis.plot(
            positions,
            [entry[f"validation_{metric}"] for entry in history],
            marker="o",
            label="Validation",
        )
        axis.set(title=title, xlabel="Stage / epoch", ylabel=ylabel)
        axis.set_xticks(list(positions), labels, rotation=45, ha="right")
        axis.grid(alpha=0.25)
        axis.legend()
        figure.tight_layout()
        figure.savefig(output_dir / filename, dpi=160)
        plt.close(figure)


def write_per_class_metrics(
    class_names: list[str],
    precision: list[float],
    recall: list[float],
    f1_score: list[float],
    support: list[int],
    output_dir: Path,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "per_class_metrics.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(("class", "precision", "recall", "f1_score", "support"))
        writer.writerows(zip(class_names, precision, recall, f1_score, support))

    positions = range(len(class_names))
    figure, axis = plt.subplots(figsize=(15, 6))
    width = 0.26
    axis.bar([position - width for position in positions], precision, width, label="Precision")
    axis.bar(positions, recall, width, label="Recall")
    axis.bar([position + width for position in positions], f1_score, width, label="F1-score")
    axis.set(
        title="Test-set per-class performance",
        xlabel="Class",
        ylabel="Score",
        xticks=list(positions),
        xticklabels=class_names,
        ylim=(0, 1.05),
    )
    axis.grid(axis="y", alpha=0.25)
    axis.legend()
    figure.tight_layout()
    figure.savefig(output_dir / "per_class_performance.png", dpi=180)
    plt.close(figure)


def save_misclassified_samples(
    records: list[dict[str, Any]],
    output_dir: Path,
    maximum_samples: int,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    mistakes = [record for record in records if record["actual"] != record["predicted"]]
    selected = mistakes[:maximum_samples]
    columns = 5
    rows = max(1, (len(selected) + columns - 1) // columns)
    figure, axes = plt.subplots(rows, columns, figsize=(columns * 3.2, rows * 3.4))
    flat_axes = list(axes.flat) if hasattr(axes, "flat") else [axes]
    for axis in flat_axes:
        axis.axis("off")

    for axis, record in zip(flat_axes, selected):
        with Image.open(record["path"]) as image:
            axis.imshow(image.convert("RGB"))
        axis.set_title(
            f"Actual: {record['actual']}  Pred: {record['predicted']}\n"
            f"Confidence: {record['confidence']:.3f}",
            fontsize=9,
        )
        axis.axis("off")

    if not selected:
        flat_axes[0].text(0.5, 0.5, "No misclassified samples", ha="center", va="center")
    figure.tight_layout()
    figure.savefig(output_dir / "misclassified_samples.png", dpi=160)
    plt.close(figure)
