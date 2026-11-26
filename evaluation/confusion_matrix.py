"""Confusion-matrix export and visualization."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import confusion_matrix as sklearn_confusion_matrix


def create_confusion_matrix(
    targets: list[int],
    predictions: list[int],
    class_names: list[str],
    output_dir: Path,
) -> np.ndarray:
    labels = list(range(len(class_names)))
    matrix = sklearn_confusion_matrix(targets, predictions, labels=labels)
    output_dir.mkdir(parents=True, exist_ok=True)
    np.savetxt(output_dir / "confusion_matrix.csv", matrix, delimiter=",", fmt="%d")

    figure_size = max(12, len(class_names) * 0.38)
    figure, axis = plt.subplots(figsize=(figure_size, figure_size))
    image = axis.imshow(matrix, interpolation="nearest", cmap="Blues")
    figure.colorbar(image, ax=axis, fraction=0.046, pad=0.04)
    axis.set(
        xticks=labels,
        yticks=labels,
        xticklabels=class_names,
        yticklabels=class_names,
        xlabel="Predicted label",
        ylabel="True label",
        title="Test-set confusion matrix",
    )
    plt.setp(axis.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")
    threshold = matrix.max() / 2 if matrix.size else 0
    for row in range(matrix.shape[0]):
        for column in range(matrix.shape[1]):
            axis.text(
                column,
                row,
                str(matrix[row, column]),
                ha="center",
                va="center",
                color="white" if matrix[row, column] > threshold else "black",
                fontsize=7,
            )
    figure.tight_layout()
    figure.savefig(output_dir / "confusion_matrix.png", dpi=180)
    plt.close(figure)
    return matrix
