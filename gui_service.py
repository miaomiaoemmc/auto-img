from __future__ import annotations

import argparse
import base64
import io
import json
from pathlib import Path

from PIL import Image, ImageOps
from ultralytics import YOLO

import main


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="JSON bridge for the web GUI.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    detect_parser = subparsers.add_parser("detect", help="Detect all faces in one image.")
    detect_parser.add_argument("--image", required=True, type=Path)
    detect_parser.add_argument("--model", required=True, type=Path)
    detect_parser.add_argument("--conf", default=0.25, type=float)

    process_parser = subparsers.add_parser("process", help="Process one selected face.")
    process_parser.add_argument("--image", required=True, type=Path)
    process_parser.add_argument("--keep-box-json")
    process_parser.add_argument("--erase-boxes-json")
    process_parser.add_argument("--face-ratio", default=0.45, type=float)

    return parser.parse_args()


def load_image(path: Path) -> Image.Image:
    with Image.open(path) as opened:
        return ImageOps.exif_transpose(opened).copy()


def image_to_data_url(image: Image.Image, format_name: str = "JPEG") -> str:
    if format_name.upper() == "JPEG" and image.mode not in {"RGB", "L"}:
        image = image.convert("RGB")

    buffer = io.BytesIO()
    image.save(buffer, format=format_name, quality=95)
    mime = "image/jpeg" if format_name.upper() == "JPEG" else "image/png"
    payload = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:{mime};base64,{payload}"


def parse_box(box_json: str) -> tuple[float, float, float, float]:
    box = json.loads(box_json)
    return float(box["x1"]), float(box["y1"]), float(box["x2"]), float(box["y2"])


def parse_boxes(boxes_json: str | None) -> list[tuple[float, float, float, float]]:
    if not boxes_json:
        return []

    boxes = json.loads(boxes_json)
    parsed: list[tuple[float, float, float, float]] = []
    for box in boxes:
        parsed.append(
            (
                float(box["x1"]),
                float(box["y1"]),
                float(box["x2"]),
                float(box["y2"]),
            )
        )
    return parsed


def run_detect(args: argparse.Namespace) -> None:
    image = load_image(args.image)
    model = YOLO(str(args.model))
    detections = main.detect_faces(model, image, args.conf)

    payload = {
        "image": {
            "width": image.size[0],
            "height": image.size[1],
            "dataUrl": image_to_data_url(image),
            "name": args.image.name,
        },
        "faces": [
            {
                "index": detection.index,
                "confidence": detection.confidence,
                "box": {
                    "x1": detection.box[0],
                    "y1": detection.box[1],
                    "x2": detection.box[2],
                    "y2": detection.box[3],
                },
                "previewDataUrl": image_to_data_url(main.face_preview(image, detection.box)),
            }
            for detection in detections
        ],
    }
    print(json.dumps(payload, ensure_ascii=False))


def run_process(args: argparse.Namespace) -> None:
    image = load_image(args.image)
    keep_box = parse_box(args.keep_box_json) if args.keep_box_json else None
    erase_boxes = parse_boxes(args.erase_boxes_json)

    if keep_box is None and not erase_boxes:
        raise SystemExit("At least one of --keep-box-json or --erase-boxes-json is required.")

    payload: dict[str, object] = {}

    if keep_box is not None:
        cropped, complete, padded, resized = main.crop_around_face(image, keep_box, args.face_ratio)
        payload["crop"] = {
            "dataUrl": image_to_data_url(cropped),
            "complete": complete,
            "padded": padded,
            "resized": resized,
            "size": {"width": cropped.size[0], "height": cropped.size[1]},
        }

    if erase_boxes:
        painted = main.paint_faces(image, erase_boxes)
        payload["painted"] = {
            "dataUrl": image_to_data_url(painted),
            "size": {"width": painted.size[0], "height": painted.size[1]},
        }

    print(json.dumps(payload, ensure_ascii=False))


def main_cli() -> int:
    args = parse_args()
    if args.command == "detect":
        run_detect(args)
    elif args.command == "process":
        run_process(args)
    else:
        raise SystemExit(f"unknown command: {args.command}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_cli())
