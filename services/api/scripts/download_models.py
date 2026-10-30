"""Build-time: download the CLIP weights into /opt/models (HF_HOME). Run by the Dockerfile."""

import os

import open_clip

model_name = os.environ.get("VISION_CLIP_MODEL", "ViT-B-32")
pretrained = os.environ.get("VISION_CLIP_PRETRAINED", "laion2b_s34b_b79k")
open_clip.create_model_and_transforms(model_name, pretrained=pretrained)
print(f"downloaded {model_name}/{pretrained}")
