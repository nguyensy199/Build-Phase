from typing import Literal, Optional
from pydantic import BaseModel, Field

class BBoxObject(BaseModel):
    track_id: int = Field(..., ge=1, description="Unique track ID")
    class_name: str = Field(..., alias="class", description="Class label: car, bus, truck, van, motorcycle, person")
    bbox: list[float] = Field(..., min_length=4, max_length=4, description="[x, y, width, height] in original pixel coordinates")
    confidence: Optional[float] = Field(1.0, ge=0.0, le=1.0)
    source: Literal["auto", "manual", "edited", "interpolated"] = "auto"

    class Config:
        populate_by_name = True

class FrameAnnotation(BaseModel):
    frame: int = Field(..., ge=0, description="0-based frame index")
    objects: list[BBoxObject] = []

class SampleInfo(BaseModel):
    sample_id: str
    name: Optional[str] = None
    type: Literal["video", "image_sequence"] = "video"
    fps: float = 30.0
    width: int
    height: int
    frame_count: int
    bbox_format: str = "xywh_pixel_topleft"
    frame_index_base: int = 0
    exported_at: Optional[str] = None
    model_version: Optional[str] = None
    tracker: Optional[str] = None

class SampleExportResponse(BaseModel):
    info: SampleInfo
    classes: list[str]
    frames: list[FrameAnnotation]
