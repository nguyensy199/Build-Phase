import json
import logging
from pathlib import Path
from typing import Any
import numpy as np
import torch

logger = logging.getLogger(__name__)

COCO_TO_PROJECT = {
    0: "person",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck"
}

class YOLOv8Detector:
    def __init__(
        self,
        model_path: str = "yolov8s.pt",
        conf_thresh: float = 0.10,
        device: str | None = None
    ):
        """
        Detector wrapper for YOLOv8.
        conf_thresh defaults to 0.10 to save low-score detections in cache for tracking.
        """
        from ultralytics import YOLO
        self.model = YOLO(model_path)
        self.conf_thresh = conf_thresh
        
        if device is None or device == "auto":
            self.device = 0 if torch.cuda.is_available() else "cpu"
        else:
            self.device = device
            
        logger.info(f"Loaded YOLO model: {model_path} on device: {self.device}")

    def detect(self, image: np.ndarray | str) -> list[dict[str, Any]]:
        results = self.model.predict(
            source=image,
            conf=self.conf_thresh,
            device=self.device,
            verbose=False
        )
        
        detections = []
        if not results:
            return detections

        r = results[0]
        boxes = r.boxes.xyxy.cpu().numpy()
        confs = r.boxes.conf.cpu().numpy()
        classes = r.boxes.cls.cpu().numpy().astype(int)

        for box, conf, cls_id in zip(boxes, confs, classes):
            if cls_id in COCO_TO_PROJECT:
                x1, y1, x2, y2 = box
                w = float(x2 - x1)
                h = float(y2 - y1)
                detections.append({
                    "bbox": [float(x1), float(y1), w, h],
                    "class": COCO_TO_PROJECT[cls_id],
                    "confidence": float(conf)
                })
        return detections
