from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None

class ProjectResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: datetime
    sample_count: int = 0

class SampleResponse(BaseModel):
    id: str
    project_id: str
    name: str
    type: Literal["video", "image_sequence"]
    fps: float
    width: int
    height: int
    frame_count: int
    status: Literal["processing", "ready", "failed"]
    review_status: Literal["unreviewed", "in_progress", "done"] = "unreviewed"
    created_at: datetime
