from __future__ import annotations

import base64
import io
import json
import shutil
import tempfile
import time
import traceback
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator
from ultralytics import YOLO

import main

# ── Configuration ──
MODEL_PATH = Path(__file__).with_name("face_yolov8s.pt").resolve()
DEFAULT_CONF = 0.25
MAX_IMAGE_SIZE_MB = 50

# ── Global model singleton ──
_model_instance: YOLO | None = None
_model_load_time: float = 0.0


def get_model() -> YOLO:
    """Return the cached YOLO model, loading it on first call."""
    global _model_instance, _model_load_time
    if _model_instance is None:
        if not MODEL_PATH.exists():
            raise RuntimeError(f"Model file not found: {MODEL_PATH}")
        start = time.perf_counter()
        _model_instance = YOLO(str(MODEL_PATH))
        _model_load_time = time.perf_counter() - start
        print(f"[MODEL] Loaded in {_model_load_time:.2f}s from {MODEL_PATH}")
    return _model_instance


# ── Pydantic schemas ──

class Box(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class DetectResponse(BaseModel):
    imageId: str
    image: dict[str, Any]
    faces: list[dict[str, Any]]


class ProcessRequest(BaseModel):
    imageId: str
    faceRatio: float = Field(default=0.45, ge=0.1, le=0.9)
    keepBox: Box | None = None
    eraseBoxes: list[Box] | None = None

    @field_validator("keepBox", "eraseBoxes", mode="before")
    @classmethod
    def parse_box_json(cls, value: Any) -> Any:
        if isinstance(value, str):
            return json.loads(value)
        return value


class ProcessResponse(BaseModel):
    crop: dict[str, Any] | None = None
    painted: dict[str, Any] | None = None


# ── Helpers ──

_temp_dir: Path | None = None
_upload_registry: dict[str, Path] = {}


def _ensure_temp_dir() -> Path:
    global _temp_dir
    if _temp_dir is None or not _temp_dir.exists():
        _temp_dir = Path(tempfile.mkdtemp(prefix="auto-img-api-"))
    return _temp_dir


def _image_to_data_url(image: Image.Image, fmt: str = "JPEG") -> str:
    if fmt.upper() == "JPEG" and image.mode not in {"RGB", "L"}:
        image = image.convert("RGB")
    buf = io.BytesIO()
    image.save(buf, format=fmt, quality=95)
    mime = "image/jpeg" if fmt.upper() == "JPEG" else "image/png"
    payload = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:{mime};base64,{payload}"


def _cleanup_upload(image_id: str) -> None:
    path = _upload_registry.pop(image_id, None)
    if path and path.exists():
        try:
            path.unlink()
        except OSError:
            pass


# ── Lifespan ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: eagerly load model
    try:
        get_model()
    except Exception as exc:
        print(f"[FATAL] Model load failed: {exc}")
        raise
    yield
    # Shutdown: cleanup temp files
    if _temp_dir and _temp_dir.exists():
        shutil.rmtree(_temp_dir, ignore_errors=True)
    _upload_registry.clear()


# ── App ──

app = FastAPI(
    title="Auto-Img API",
    description="High-performance face detection & cropping service.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model_loaded": _model_instance is not None,
        "model_load_time_ms": round(_model_load_time * 1000, 1),
        "uploads_in_memory": len(_upload_registry),
    }


@app.post("/detect", response_model=DetectResponse)
async def detect(
    file: UploadFile = File(...),
    conf: float = Form(default=DEFAULT_CONF),
) -> dict[str, Any]:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Uploaded file is not an image.",
        )

    temp_root = _ensure_temp_dir()
    safe_name = Path(file.filename or "upload").name
    upload_id = f"{uuid.uuid4().hex[:12]}-{safe_name}"
    upload_path = temp_root / upload_id

    try:
        content = await file.read()
        if len(content) > MAX_IMAGE_SIZE_MB * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Image exceeds {MAX_IMAGE_SIZE_MB}MB limit.",
            )
        upload_path.write_bytes(content)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save upload: {exc}",
        )

    try:
        with Image.open(upload_path) as opened:
            image = ImageOps.exif_transpose(opened).copy()
    except (OSError, UnidentifiedImageError) as exc:
        upload_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid image file: {exc}",
        )

    _upload_registry[upload_id] = upload_path

    try:
        model = get_model()
        detections = main.detect_faces(model, image, conf)

        payload = {
            "imageId": upload_id,
            "image": {
                "width": image.size[0],
                "height": image.size[1],
                "name": file.filename or "upload",
            },
            "faces": [
                {
                    "index": d.index,
                    "confidence": d.confidence,
                    "box": {"x1": d.box[0], "y1": d.box[1], "x2": d.box[2], "y2": d.box[3]},
                    "previewDataUrl": _image_to_data_url(main.face_preview(image, d.box)),
                }
                for d in detections
            ],
        }
        return payload
    except Exception as exc:
        traceback.print_exc()
        _cleanup_upload(upload_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Detection failed: {exc}",
        )


@app.post("/process", response_model=ProcessResponse)
async def process(body: ProcessRequest) -> dict[str, Any]:
    upload_path = _upload_registry.get(body.imageId)
    if not upload_path or not upload_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found or expired. Please re-upload.",
        )

    try:
        image = main.load_image(upload_path)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Cannot open image: {exc}",
        )

    keep_box = (
        (body.keepBox.x1, body.keepBox.y1, body.keepBox.x2, body.keepBox.y2)
        if body.keepBox
        else None
    )
    erase_boxes = [
        (b.x1, b.y1, b.x2, b.y2) for b in (body.eraseBoxes or []) if b is not None
    ]

    if keep_box is None and not erase_boxes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of keepBox or eraseBoxes is required.",
        )

    payload: dict[str, Any] = {}

    try:
        if keep_box is not None:
            cropped, complete, padded, resized = main.crop_around_face(
                image, keep_box, body.faceRatio
            )
            payload["crop"] = {
                "dataUrl": _image_to_data_url(cropped),
                "complete": complete,
                "padded": padded,
                "resized": resized,
                "size": {"width": cropped.size[0], "height": cropped.size[1]},
            }

        if erase_boxes:
            painted = main.paint_faces(image, erase_boxes)
            payload["painted"] = {
                "dataUrl": _image_to_data_url(painted),
                "size": {"width": painted.size[0], "height": painted.size[1]},
            }

        return payload
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Processing failed: {exc}",
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api_server:app", host="127.0.0.1", port=8000, log_level="info")
