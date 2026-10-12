import json
import logging
from pathlib import Path
from typing import Any, Callable, Optional
import cv2

logger = logging.getLogger(__name__)

class FrameExtractionService:
    @staticmethod
    def extract_video_frames(
        video_path: Path,
        output_dir: Path,
        jpeg_quality: int = 90,
        progress_cb: Optional[Callable[[int, int], None]] = None
    ) -> dict[str, Any]:
        """
        Extracts all frames from a video file into JPEG images.
        Frames are numbered starting from 0: frame_000000.jpg, frame_000001.jpg, ...
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise ValueError(f"Cannot open video file: {video_path}")

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        if fps <= 0:
            fps = 30.0
        reported_frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        frame_idx = 0
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality]

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_filename = output_dir / f"frame_{frame_idx:06d}.jpg"
            cv2.imwrite(str(frame_filename), frame, encode_params)

            if progress_cb and reported_frame_count > 0 and frame_idx % 30 == 0:
                progress_cb(frame_idx, reported_frame_count)

            frame_idx += 1

        cap.release()

        # Save metadata to sample directory
        meta = {
            "width": width,
            "height": height,
            "fps": round(fps, 2),
            "frame_count": frame_idx,
            "bbox_format": "xywh_pixel_topleft",
            "frame_index_base": 0
        }
        with open(output_dir / "metadata.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        logger.info(f"Extracted {frame_idx} frames to {output_dir}")
        return meta
