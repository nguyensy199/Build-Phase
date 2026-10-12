import logging
from pathlib import Path
from typing import Any
import torch

logger = logging.getLogger(__name__)

class TrackerAdapter:
    def __init__(
        self,
        tracker_type: str = "botsort",
        conf_thresh: float = 0.25,
        model_path: str = "yolov8s.pt",
        device: str | None = None
    ):
        """
        Tracker adapter supporting BoT-SORT (default) and ByteTrack.
        Auto detects CUDA GPU or falls back cleanly to CPU.
        """
        from ultralytics import YOLO
        self.model = YOLO(model_path)
        self.tracker_type = tracker_type
        self.conf_thresh = conf_thresh
        
        # Auto-detect CUDA vs CPU fallback (A-05)
        if device is None or device == "auto":
            self.device = 0 if torch.cuda.is_available() else "cpu"
        else:
            self.device = device
            
        self.tracker_yaml = f"{tracker_type}.yaml"
        logger.info(f"Initialized Tracker: {tracker_type} on device: {self.device}")

    def track_video(self, source_path: str | Path, progress_cb=None) -> list[dict[str, Any]]:
        """
        Tracks objects through video frames or image directory.
        Returns a list of frame tracking results.
        """
        results = self.model.track(
            source=str(source_path),
            tracker=self.tracker_yaml,
            conf=self.conf_thresh,
            device=self.device,
            stream=True,
            persist=True,
            verbose=False
        )

        from ai.detector import COCO_TO_PROJECT

        tracked_frames = []
        frame_idx = 0

        for r in results:
            frame_objects = []
            if r.boxes and r.boxes.id is not None:
                boxes = r.boxes.xyxy.cpu().numpy()
                track_ids = r.boxes.id.int().cpu().numpy()
                confs = r.boxes.conf.cpu().numpy()
                classes = r.boxes.cls.cpu().numpy().astype(int)

                for box, track_id, conf, cls_id in zip(boxes, track_ids, confs, classes):
                    if cls_id in COCO_TO_PROJECT:
                        x1, y1, x2, y2 = box
                        w = float(x2 - x1)
                        h = float(y2 - y1)
                        frame_objects.append({
                            "track_id": int(track_id),
                            "class": COCO_TO_PROJECT[cls_id],
                            "bbox": [round(float(x1), 2), round(float(y1), 2), round(w, 2), round(h, 2)],
                            "confidence": round(float(conf), 3),
                            "source": "auto"
                        })

            tracked_frames.append({
                "frame": frame_idx,
                "objects": frame_objects
            })
            frame_idx += 1
            if progress_cb and frame_idx % 30 == 0:
                progress_cb(frame_idx)

        return tracked_frames
