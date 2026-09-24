"""Train a semantic-segmentation model on RUGD-style image/mask pairs."""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

import numpy as np
import torch
from PIL import Image
from torch import Tensor, nn
from torch.utils.data import DataLoader, Dataset, random_split
from torchvision.models.segmentation import (
    DeepLabV3_ResNet50_Weights,
    deeplabv3_resnet50,
)
from tqdm import tqdm


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}
IGNORE_INDEX = 255


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--masks", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("ml/checkpoints/rugd_deeplabv3.pt"))
    parser.add_argument("--classes", type=int, required=True)
    parser.add_argument("--palette-json", type=Path)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--image-size", type=int, default=512)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--validation-split", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--workers", type=int, default=2)
    return parser.parse_args()


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def load_palette(path: Path | None) -> Dict[Tuple[int, int, int], int]:
    if path is None:
        return {}
    raw_palette = json.loads(path.read_text())
    return {tuple(map(int, key.split(","))): int(value) for key, value in raw_palette.items()}


def find_pairs(images_dir: Path, masks_dir: Path) -> List[Tuple[Path, Path]]:
    image_files = {
        image_path.stem: image_path
        for image_path in images_dir.rglob("*")
        if image_path.suffix.lower() in IMAGE_EXTENSIONS
    }
    mask_files = {
        mask_path.stem: mask_path
        for mask_path in masks_dir.rglob("*")
        if mask_path.suffix.lower() in IMAGE_EXTENSIONS
    }
    pairs = [(image_files[key], mask_files[key]) for key in sorted(image_files.keys() & mask_files.keys())]
    if not pairs:
        raise ValueError(f"No image/mask pairs found: {images_dir} and {masks_dir}")
    return pairs


def validate_dataset(images_dir: Path, masks_dir: Path) -> None:
    image_count = sum(1 for path in images_dir.rglob("*") if path.suffix.lower() in IMAGE_EXTENSIONS)
    mask_count = sum(1 for path in masks_dir.rglob("*") if path.suffix.lower() in IMAGE_EXTENSIONS)
    if image_count == 0:
        raise ValueError(f"No images found under {images_dir}")
    if mask_count == 0:
        raise ValueError(
            f"No annotation masks found under {masks_dir}. "
            "RUGD camera frames alone cannot train semantic segmentation."
        )


class RUGDSegmentation(Dataset[Tuple[Tensor, Tensor]]):
    def __init__(self, pairs: Sequence[Tuple[Path, Path]], image_size: int, palette: Dict[Tuple[int, int, int], int]):
        self.pairs = list(pairs)
        self.image_size = image_size
        self.palette = palette

    def __len__(self) -> int:
        return len(self.pairs)

    def __getitem__(self, index: int) -> Tuple[Tensor, Tensor]:
        image_path, mask_path = self.pairs[index]
        image = Image.open(image_path).convert("RGB")
        mask = Image.open(mask_path)

        image = image.resize((self.image_size, self.image_size), Image.Resampling.BILINEAR)
        mask = mask.resize((self.image_size, self.image_size), Image.Resampling.NEAREST)
        image_array = np.asarray(image, dtype=np.float32) / 255.0
        mask_array = np.asarray(mask)

        if mask_array.ndim == 3:
            if not self.palette:
                raise ValueError("RGB masks require --palette-json with 'R,G,B' keys.")
            indexed_mask = np.full(mask_array.shape[:2], IGNORE_INDEX, dtype=np.int64)
            for color, class_id in self.palette.items():
                indexed_mask[np.all(mask_array[:, :, :3] == color, axis=2)] = class_id
            mask_array = indexed_mask
        else:
            mask_array = mask_array.astype(np.int64)

        image_tensor = torch.from_numpy(image_array).permute(2, 0, 1)
        mask_tensor = torch.from_numpy(mask_array.copy())
        return image_tensor, mask_tensor


def make_model(num_classes: int) -> nn.Module:
    model = deeplabv3_resnet50(weights=DeepLabV3_ResNet50_Weights.DEFAULT)
    classifier = model.classifier[4]
    model.classifier[4] = nn.Conv2d(classifier.in_channels, num_classes, kernel_size=1)
    return model


def run_epoch(model: nn.Module, loader: DataLoader, loss_fn: nn.Module, optimizer, device: torch.device, training: bool) -> float:
    model.train(training)
    total_loss = 0.0
    for images, masks in tqdm(loader, leave=False):
        images, masks = images.to(device), masks.to(device)
        with torch.set_grad_enabled(training):
            logits = model(images)["out"]
            loss = loss_fn(logits, masks)
            if training:
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                optimizer.step()
        total_loss += loss.item() * images.size(0)
    return total_loss / len(loader.dataset)


def main() -> None:
    args = parse_args()
    if not 0 < args.validation_split < 1:
        raise ValueError("--validation-split must be between 0 and 1")
    seed_everything(args.seed)

    validate_dataset(args.images, args.masks)
    pairs = find_pairs(args.images, args.masks)
    dataset = RUGDSegmentation(pairs, args.image_size, load_palette(args.palette_json))
    validation_size = max(1, int(len(dataset) * args.validation_split))
    training_size = len(dataset) - validation_size
    if training_size < 1:
        raise ValueError("Dataset must contain at least two image/mask pairs.")
    training_set, validation_set = random_split(
        dataset,
        [training_size, validation_size],
        generator=torch.Generator().manual_seed(args.seed),
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    model = make_model(args.classes).to(device)
    loss_fn = nn.CrossEntropyLoss(ignore_index=IGNORE_INDEX)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    training_loader = DataLoader(training_set, batch_size=args.batch_size, shuffle=True, num_workers=args.workers)
    validation_loader = DataLoader(validation_set, batch_size=args.batch_size, shuffle=False, num_workers=args.workers)

    best_validation_loss = float("inf")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for epoch in range(1, args.epochs + 1):
        training_loss = run_epoch(model, training_loader, loss_fn, optimizer, device, training=True)
        validation_loss = run_epoch(model, validation_loader, loss_fn, optimizer, device, training=False)
        print(f"epoch={epoch:03d} train_loss={training_loss:.4f} val_loss={validation_loss:.4f}")
        if validation_loss < best_validation_loss:
            best_validation_loss = validation_loss
            torch.save(
                {
                    "model_state": model.state_dict(),
                    "num_classes": args.classes,
                    "image_size": args.image_size,
                    "validation_loss": validation_loss,
                    "class_palette": args.palette_json.read_text() if args.palette_json else None,
                },
                args.output,
            )
    print(f"saved_checkpoint={args.output} device={device} pairs={len(pairs)}")


if __name__ == "__main__":
    main()