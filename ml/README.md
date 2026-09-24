# TRINETRA ML Training

The RUGD dataset provides semantic segmentation labels, not driving commands. Train a segmentation model first, then use a reviewed policy layer to convert the predicted classes in the vehicle's forward corridor into `FORWARD`, `SLOW_DOWN`, `TURN`, or `STOP` commands. Keep Gemini as an optional comparison/fallback until the local model has been evaluated on held-out forest and mountain-trail footage.

## Dataset layout

The training script pairs files by filename stem:

```text
dataset/
  images/
    frame_0001.png
  masks/
    frame_0001.png
```

Indexed masks can be used directly. RGB masks require a JSON palette such as:

```json
{
  "0,0,0": 0,
  "128,128,128": 1,
  "0,128,0": 2
}
```

The palette values must be contiguous class IDs from `0` through `classes - 1`. Verify the RUGD palette against the annotation files before training; do not guess class colors.

The folder `/Users/avinash/Downloads/RUGD_frames-with-annotations` currently contains camera frames only. Despite its name, it does not contain annotation masks, so the command will stop with a clear error until the separate RUGD masks are supplied.

## Training

```bash
cd ml
python3 -m pip install -r requirements.txt
python3 train_rugd.py \
  --images /path/to/rugd/images \
  --masks /path/to/rugd/annotations \
  --classes 24 \
  --palette-json /path/to/rugd_palette.json \
  --output checkpoints/trinetra_rugd.pt
```

The script uses a pretrained DeepLabV3-ResNet50 backbone and saves the lowest-validation-loss checkpoint. Training on an MPS Mac is supported automatically when PyTorch exposes MPS; otherwise it uses CUDA or CPU.

Before autonomous driving, measure per-class IoU and test the policy with recorded video in manual mode. A segmentation loss alone is not evidence that the vehicle can safely choose actions.