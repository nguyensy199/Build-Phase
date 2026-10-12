import io
import json
import time
import zipfile
from typing import Dict, Any, List, Optional
import jsonschema

from app.core.config import settings

def load_schema() -> Dict[str, Any]:
    schema_path = settings.CONFIGS_PATH / "annotation_schema.json"
    if schema_path.exists():
        with open(schema_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def validate_annotation_schema(data: Dict[str, Any]) -> tuple[bool, str]:
    """Validate JSON against BBox2DTrackingExportSchema"""
    schema = load_schema()
    if not schema:
        return True, "Schema file not found, skipping strict validation"
    try:
        # Create a shallow copy for validation without custom frontend fields if any
        val_data = {
            "info": {
                "sample_id": str(data.get("info", {}).get("sample_id", "")),
                "type": data.get("info", {}).get("type", "video"),
                "fps": float(data.get("info", {}).get("fps", 30.0)),
                "width": int(data.get("info", {}).get("width", 1920)),
                "height": int(data.get("info", {}).get("height", 1080)),
                "frame_count": int(data.get("info", {}).get("frame_count", len(data.get("frames", [])))),
                "bbox_format": "xywh_pixel_topleft",
                "frame_index_base": 0
            },
            "classes": data.get("classes", ["car", "bus", "truck", "van", "motorcycle", "person"]),
            "frames": []
        }
        
        if "name" in data.get("info", {}):
            val_data["info"]["name"] = str(data["info"]["name"])
        if "exported_at" in data.get("info", {}):
            val_data["info"]["exported_at"] = str(data["info"]["exported_at"])
        if "model_version" in data.get("info", {}):
            val_data["info"]["model_version"] = str(data["info"]["model_version"])
        if "tracker" in data.get("info", {}):
            val_data["info"]["tracker"] = str(data["info"]["tracker"])

        for f in data.get("frames", []):
            frame_obj = {
                "frame": int(f.get("frame", 0)),
                "objects": []
            }
            for obj in f.get("objects", []):
                clean_obj = {
                    "track_id": int(obj.get("track_id", 1)),
                    "class": str(obj.get("class", "car")),
                    "bbox": [float(c) for c in obj.get("bbox", [0, 0, 0, 0])]
                }
                if "confidence" in obj and obj["confidence"] is not None:
                    clean_obj["confidence"] = float(obj["confidence"])
                if "source" in obj and obj["source"] in ["auto", "manual", "edited", "interpolated"]:
                    clean_obj["source"] = obj["source"]
                frame_obj["objects"].append(clean_obj)
            val_data["frames"].append(frame_obj)

        jsonschema.validate(instance=val_data, schema=schema)
        return True, "Valid"
    except jsonschema.exceptions.ValidationError as e:
        return False, f"Validation error at {e.json_path}: {e.message}"
    except Exception as e:
        return False, str(e)

def export_json_format(
    data: Dict[str, Any],
    verified_only: bool = False,
    verified_frames: Optional[List[int]] = None
) -> Dict[str, Any]:
    """
    Format standard BBox 2D Tracking JSON export (T-130, EXP-01..06).
    Preserves all frames from 0 to frame_count - 1. Empty frames have objects: [].
    """
    info = dict(data.get("info", {}))
    info["exported_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    info["bbox_format"] = "xywh_pixel_topleft"
    info["frame_index_base"] = 0
    
    classes = data.get("classes", ["car", "bus", "truck", "van", "motorcycle", "person"])
    frames = data.get("frames", [])
    
    verified_set = set(verified_frames) if (verified_only and verified_frames is not None) else None
    
    output_frames = []
    for f in frames:
        f_idx = f.get("frame", 0)
        if verified_set is not None and f_idx not in verified_set:
            # If exporting verified frames only, keep frame entry empty or skip?
            # Schema requires continuous or existing frames. We keep frame entry with empty objects if filtered.
            output_frames.append({"frame": f_idx, "objects": []})
            continue

        clean_objects = []
        for obj in f.get("objects", []):
            clean_obj = {
                "track_id": int(obj.get("track_id", 1)),
                "class": str(obj.get("class", "car")),
                "bbox": [round(float(c), 2) for c in obj.get("bbox", [0, 0, 0, 0])]
            }
            if "confidence" in obj and obj["confidence"] is not None:
                clean_obj["confidence"] = round(float(obj["confidence"]), 4)
            if "source" in obj and obj["source"]:
                clean_obj["source"] = obj["source"]
            clean_objects.append(clean_obj)

        output_frames.append({
            "frame": f_idx,
            "objects": clean_objects
        })

    # Sort frames by frame index
    output_frames.sort(key=lambda x: x["frame"])

    return {
        "info": info,
        "classes": classes,
        "frames": output_frames
    }

def export_mot_challenge(
    data: Dict[str, Any],
    verified_only: bool = False,
    verified_frames: Optional[List[int]] = None
) -> str:
    """
    MOTChallenge format (T-131, EXP-08):
    <frame_1based>,<track_id>,<bb_left>,<bb_top>,<bb_width>,<bb_height>,<conf>,-1,-1,-1
    """
    lines = []
    verified_set = set(verified_frames) if (verified_only and verified_frames is not None) else None

    frames = sorted(data.get("frames", []), key=lambda x: x.get("frame", 0))
    for f in frames:
        f_idx = f.get("frame", 0)
        if verified_set is not None and f_idx not in verified_set:
            continue
        
        # MOT format is 1-based frame index
        mot_frame = f_idx + 1
        for obj in f.get("objects", []):
            track_id = int(obj.get("track_id", 1))
            bbox = obj.get("bbox", [0, 0, 0, 0])
            bb_left = round(float(bbox[0]), 2)
            bb_top = round(float(bbox[1]), 2)
            bb_width = round(float(bbox[2]), 2)
            bb_height = round(float(bbox[3]), 2)
            conf = round(float(obj.get("confidence", 1.0)), 2) if obj.get("confidence") is not None else 1.0
            
            line = f"{mot_frame},{track_id},{bb_left},{bb_top},{bb_width},{bb_height},{conf},-1,-1,-1"
            lines.append(line)

    return "\n".join(lines) + ("\n" if lines else "")

def export_coco_format(
    data: Dict[str, Any],
    verified_only: bool = False,
    verified_frames: Optional[List[int]] = None
) -> Dict[str, Any]:
    """
    Standard COCO Object Detection JSON format with track_id extension.
    """
    info = data.get("info", {})
    width = info.get("width", 1920)
    height = info.get("height", 1080)
    classes = data.get("classes", ["car", "bus", "truck", "van", "motorcycle", "person"])
    
    cat_to_id = {cls_name: idx + 1 for idx, cls_name in enumerate(classes)}
    categories = [{"id": idx + 1, "name": cls_name, "supercategory": "vehicle_or_human"} for idx, cls_name in enumerate(classes)]

    images = []
    annotations = []
    ann_counter = 1

    verified_set = set(verified_frames) if (verified_only and verified_frames is not None) else None
    frames = sorted(data.get("frames", []), key=lambda x: x.get("frame", 0))

    for f in frames:
        f_idx = f.get("frame", 0)
        if verified_set is not None and f_idx not in verified_set:
            continue

        images.append({
            "id": f_idx,
            "file_name": f"frame_{f_idx:06d}.jpg",
            "width": width,
            "height": height
        })

        for obj in f.get("objects", []):
            cls_name = obj.get("class", "car")
            cat_id = cat_to_id.get(cls_name, 1)
            bbox = [round(float(c), 2) for c in obj.get("bbox", [0, 0, 0, 0])]
            area = round(bbox[2] * bbox[3], 2)
            
            annotations.append({
                "id": ann_counter,
                "image_id": f_idx,
                "category_id": cat_id,
                "bbox": bbox,
                "area": area,
                "track_id": int(obj.get("track_id", 1)),
                "iscrowd": 0,
                "score": float(obj.get("confidence", 1.0)) if obj.get("confidence") is not None else 1.0
            })
            ann_counter += 1

    return {
        "info": {
            "description": f"Ground Truth for {info.get('name', 'Sample')}",
            "sample_id": info.get("sample_id", ""),
            "date_created": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
        },
        "categories": categories,
        "images": images,
        "annotations": annotations
    }

def export_yolo_zip(
    data: Dict[str, Any],
    verified_only: bool = False,
    verified_frames: Optional[List[int]] = None
) -> bytes:
    """
    YOLO tracking format:
    Each frame has a text file `labels/frame_000000.txt`.
    Line: <class_id> <x_center_norm> <y_center_norm> <width_norm> <height_norm> <track_id>
    Includes data.yaml.
    """
    info = data.get("info", {})
    w_img = max(float(info.get("width", 1920)), 1.0)
    h_img = max(float(info.get("height", 1080)), 1.0)
    classes = data.get("classes", ["car", "bus", "truck", "van", "motorcycle", "person"])
    cls_to_id = {cls_name: idx for idx, cls_name in enumerate(classes)}

    verified_set = set(verified_frames) if (verified_only and verified_frames is not None) else None
    frames = sorted(data.get("frames", []), key=lambda x: x.get("frame", 0))

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        # Create data.yaml
        yaml_lines = [
            f"names: {json.dumps(classes)}",
            f"nc: {len(classes)}",
            "path: .",
            "train: images",
            "val: images"
        ]
        zip_file.writestr("data.yaml", "\n".join(yaml_lines) + "\n")

        # Create txt label files for each frame
        for f in frames:
            f_idx = f.get("frame", 0)
            if verified_set is not None and f_idx not in verified_set:
                continue

            lines = []
            for obj in f.get("objects", []):
                cls_name = obj.get("class", "car")
                cls_id = cls_to_id.get(cls_name, 0)
                track_id = int(obj.get("track_id", 1))
                bx, by, bw, bh = obj.get("bbox", [0, 0, 0, 0])
                
                # Normalize coordinates
                x_center = (bx + bw / 2.0) / w_img
                y_center = (by + bh / 2.0) / h_img
                norm_w = bw / w_img
                norm_h = bh / h_img

                # Clamp to 0..1
                x_center = max(0.0, min(1.0, x_center))
                y_center = max(0.0, min(1.0, y_center))
                norm_w = max(0.0, min(1.0, norm_w))
                norm_h = max(0.0, min(1.0, norm_h))

                lines.append(f"{cls_id} {x_center:.6f} {y_center:.6f} {norm_w:.6f} {norm_h:.6f} {track_id}")

            content = "\n".join(lines) + ("\n" if lines else "")
            zip_file.writestr(f"labels/frame_{f_idx:06d}.txt", content)

    zip_buffer.seek(0)
    return zip_buffer.getvalue()
