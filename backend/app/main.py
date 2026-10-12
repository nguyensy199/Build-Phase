import json
import logging
import os
import re
import shutil
import sys
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any
import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

# Ensure root directory is on sys.path for ai module imports
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings
from app.services.frame_extractor import FrameExtractionService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Traffic Labeling Tool API (BBox 2D + Tracker)"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def natural_sort_key(s: str):
    """Natural sort key: img2.jpg comes before img10.jpg"""
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]

@app.get("/health", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "project": settings.PROJECT_NAME,
        "version": settings.VERSION
    }

@app.get(f"{settings.API_V1_STR}/classes", tags=["Config"])
def get_classes():
    classes_file = settings.CONFIGS_PATH / "classes.json"
    if not classes_file.exists():
        raise HTTPException(status_code=404, detail="Classes config not found")
    with open(classes_file, "r", encoding="utf-8") as f:
        return json.load(f)

@app.get(f"{settings.API_V1_STR}/samples", tags=["Samples"])
def list_samples():
    """List all extracted samples with metadata."""
    samples = []
    if settings.FRAMES_PATH.exists():
        for sample_dir in settings.FRAMES_PATH.iterdir():
            if sample_dir.is_dir():
                meta_file = sample_dir / "metadata.json"
                if meta_file.exists():
                    with open(meta_file, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    samples.append({
                        "sample_id": sample_dir.name,
                        **meta
                    })
    return samples

@app.post(f"{settings.API_V1_STR}/upload", tags=["Upload"])
async def upload_video(file: UploadFile = File(...)):
    """
    Step 1A: Upload video file (.mp4, .avi, .mov).
    Extracts frames to data/frames/{sample_id}/ and initializes annotation file.
    """
    ext = Path(file.filename).suffix.lower()
    if ext not in settings.ALLOWED_VIDEO_EXTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Định dạng {ext} không được hỗ trợ. Chỉ nhận video: {', '.join(settings.ALLOWED_VIDEO_EXTS)}"
        )

    sample_id = f"sample_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    raw_video_path = settings.RAW_PATH / f"{sample_id}{ext}"
    settings.RAW_PATH.mkdir(parents=True, exist_ok=True)

    with open(raw_video_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    frames_dir = settings.FRAMES_PATH / sample_id
    try:
        meta = FrameExtractionService.extract_video_frames(
            video_path=raw_video_path,
            output_dir=frames_dir
        )
    except Exception as e:
        logger.error(f"Lỗi extract frames: {e}")
        raise HTTPException(status_code=500, detail=f"Không thể tách frame từ video: {str(e)}")

    meta["type"] = "video"
    meta["name"] = file.filename
    with open(frames_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    # Initialize empty annotation structure
    classes_file = settings.CONFIGS_PATH / "classes.json"
    with open(classes_file, "r", encoding="utf-8") as f:
        cls_data = json.load(f)
    classes_list = [c["name"] for c in cls_data.get("classes", [])]

    initial_annotation = {
        "info": {
            "sample_id": sample_id,
            "name": file.filename,
            "type": "video",
            "fps": meta["fps"],
            "width": meta["width"],
            "height": meta["height"],
            "frame_count": meta["frame_count"],
            "bbox_format": "xywh_pixel_topleft",
            "frame_index_base": 0,
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "model_version": None,
            "tracker": None
        },
        "classes": classes_list,
        "frames": [
            {"frame": idx, "objects": []} for idx in range(meta["frame_count"])
        ]
    }

    settings.DETECTIONS_PATH.mkdir(parents=True, exist_ok=True)
    det_file = settings.DETECTIONS_PATH / f"{sample_id}.json"
    with open(det_file, "w", encoding="utf-8") as f:
        json.dump(initial_annotation, f, indent=2)

    return {
        "status": "success",
        "sample_id": sample_id,
        "filename": file.filename,
        **meta
    }

@app.post(f"{settings.API_V1_STR}/upload-images", tags=["Upload"])
async def upload_image_sequence(
    file: UploadFile = File(...),
    fps: float = Form(30.0)
):
    """
    Step 1B (T-013, T-021): Upload image sequence (ZIP archive containing jpg/png images).
    Validates identical image dimensions, applies natural sort, standardizes to frame_000000.jpg.
    """
    if fps <= 0:
        fps = 30.0

    filename = file.filename or "images.zip"
    ext = Path(filename).suffix.lower()

    if ext != ".zip":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chuỗi ảnh cần được đóng gói dưới định dạng file .ZIP"
        )

    sample_id = f"seq_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    raw_zip_path = settings.RAW_PATH / f"{sample_id}.zip"
    settings.RAW_PATH.mkdir(parents=True, exist_ok=True)

    with open(raw_zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    temp_extract_dir = settings.DATA_PATH / "temp" / sample_id
    temp_extract_dir.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(raw_zip_path, "r") as z:
            z.extractall(temp_extract_dir)

        # Collect all image files
        valid_exts = {".jpg", ".jpeg", ".png"}
        image_files = []
        for root, _, files in os.walk(temp_extract_dir):
            for f in files:
                if Path(f).suffix.lower() in valid_exts and not f.startswith("."):
                    image_files.append(Path(root) / f)

        if not image_files:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File ZIP không chứa ảnh hợp lệ (.jpg, .png)"
            )

        # Natural sort: img2 < img10
        image_files.sort(key=lambda p: natural_sort_key(p.name))

        frames_dir = settings.FRAMES_PATH / sample_id
        frames_dir.mkdir(parents=True, exist_ok=True)

        first_img = cv2.imread(str(image_files[0]))
        if first_img is None:
            raise HTTPException(status_code=400, detail="Ảnh đầu tiên không đọc được")
        height, width = first_img.shape[:2]

        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), 90]

        for idx, img_path in enumerate(image_files):
            img = cv2.imread(str(img_path))
            if img is None:
                continue
            h, w = img.shape[:2]
            if w != width or h != height:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Ảnh {img_path.name} kích thước ({w}x{h}) khác với ảnh đầu ({width}x{height}). Backlog quy định ảnh trong sequence phải cùng kích thước."
                )
            dest_frame = frames_dir / f"frame_{idx:06d}.jpg"
            cv2.imwrite(str(dest_frame), img, encode_params)

        frame_count = len(image_files)
        meta = {
            "type": "image_sequence",
            "name": filename,
            "width": width,
            "height": height,
            "fps": round(fps, 2),
            "frame_count": frame_count,
            "bbox_format": "xywh_pixel_topleft",
            "frame_index_base": 0
        }
        with open(frames_dir / "metadata.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        classes_file = settings.CONFIGS_PATH / "classes.json"
        with open(classes_file, "r", encoding="utf-8") as f:
            cls_data = json.load(f)
        classes_list = [c["name"] for c in cls_data.get("classes", [])]

        initial_annotation = {
            "info": {
                "sample_id": sample_id,
                "name": filename,
                "type": "image_sequence",
                "fps": round(fps, 2),
                "width": width,
                "height": height,
                "frame_count": frame_count,
                "bbox_format": "xywh_pixel_topleft",
                "frame_index_base": 0,
                "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "model_version": None,
                "tracker": None
            },
            "classes": classes_list,
            "frames": [
                {"frame": idx, "objects": []} for idx in range(frame_count)
            ]
        }

        settings.DETECTIONS_PATH.mkdir(parents=True, exist_ok=True)
        det_file = settings.DETECTIONS_PATH / f"{sample_id}.json"
        with open(det_file, "w", encoding="utf-8") as f:
            json.dump(initial_annotation, f, indent=2)

        return {
            "status": "success",
            "sample_id": sample_id,
            "filename": filename,
            **meta
        }

    finally:
        if temp_extract_dir.exists():
            shutil.rmtree(temp_extract_dir, ignore_errors=True)

@app.get(f"{settings.API_V1_STR}/samples/{{sample_id}}/frames/{{frame_idx}}", tags=["Frames"])
def get_frame(sample_id: str, frame_idx: int):
    """Serve specific frame JPEG."""
    frame_path = settings.FRAMES_PATH / sample_id / f"frame_{frame_idx:06d}.jpg"
    if not frame_path.exists():
        raise HTTPException(status_code=404, detail=f"Frame {frame_idx} không tồn tại")
    return FileResponse(frame_path, media_type="image/jpeg")

@app.get(f"{settings.API_V1_STR}/samples/{{sample_id}}/annotations", tags=["Annotations"])
def get_annotations(sample_id: str):
    """Get current annotations for a sample."""
    det_file = settings.DETECTIONS_PATH / f"{sample_id}.json"
    if not det_file.exists():
        if sample_id == "sample_demo_01" or sample_id == "sample_traffic_001":
            mock_file = settings.CONFIGS_PATH / "sample_annotation.json"
            if mock_file.exists():
                with open(mock_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        raise HTTPException(status_code=404, detail="Annotation không tồn tại")
    with open(det_file, "r", encoding="utf-8") as f:
        return json.load(f)

@app.put(f"{settings.API_V1_STR}/samples/{{sample_id}}/annotations", tags=["Annotations"])
def save_annotations(sample_id: str, data: dict = ...):
    """
    Step 4: Human-in-the-loop save.
    Saves user-corrected bounding boxes and track IDs.
    """
    det_file = settings.DETECTIONS_PATH / f"{sample_id}.json"
    settings.DETECTIONS_PATH.mkdir(parents=True, exist_ok=True)
    with open(det_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return {"status": "saved", "sample_id": sample_id}

@app.post(f"{settings.API_V1_STR}/samples/{{sample_id}}/auto-label", tags=["AI"])
def run_auto_label(sample_id: str, tracker_type: str = "botsort", conf: float = 0.25):
    """
    Step 2: AI Pre-labeling.
    Runs YOLOv8 detector + BoT-SORT / ByteTrack tracker.
    Supports both raw video and image sequence frame directories!
    """
    frames_dir = settings.FRAMES_PATH / sample_id
    if not frames_dir.exists():
        raise HTTPException(status_code=404, detail=f"Không tìm thấy dữ liệu frame của sample {sample_id}")

    raw_files = list(settings.RAW_PATH.glob(f"{sample_id}.*"))
    tracking_source = raw_files[0] if raw_files and raw_files[0].suffix != ".zip" else frames_dir

    try:
        from ai.tracker import TrackerAdapter
        tracker = TrackerAdapter(
            tracker_type=tracker_type,
            conf_thresh=conf,
            model_path="yolov8s.pt"
        )
        tracked_frames = tracker.track_video(tracking_source)

        det_file = settings.DETECTIONS_PATH / f"{sample_id}.json"
        if det_file.exists():
            with open(det_file, "r", encoding="utf-8") as f:
                annotation_data = json.load(f)
        else:
            annotation_data = {
                "info": {"sample_id": sample_id},
                "classes": ["car", "bus", "truck", "van", "motorcycle", "person"],
                "frames": []
            }

        annotation_data["info"]["model_version"] = "yolov8s_coco"
        annotation_data["info"]["tracker"] = tracker_type
        annotation_data["frames"] = tracked_frames

        with open(det_file, "w", encoding="utf-8") as f:
            json.dump(annotation_data, f, indent=2)

        return {
            "status": "success",
            "sample_id": sample_id,
            "tracker": tracker_type,
            "total_frames_tracked": len(tracked_frames),
            "annotation": annotation_data
        }
    except Exception as e:
        logger.error(f"Lỗi AI tracking: {e}")
        raise HTTPException(status_code=500, detail=f"Lỗi khi chạy AI auto-label: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
