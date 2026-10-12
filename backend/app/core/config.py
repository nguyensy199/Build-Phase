from pathlib import Path
from pydantic_settings import BaseSettings

# Root directory of the repository
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
DATA_DIR = BASE_DIR / "data"
CONFIGS_DIR = BASE_DIR / "configs"

class Settings(BaseSettings):
    PROJECT_NAME: str = "BBox2D Traffic Labeling Tool"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    
    # Storage paths
    DATA_PATH: Path = DATA_DIR
    RAW_PATH: Path = DATA_DIR / "raw"
    FRAMES_PATH: Path = DATA_DIR / "frames"
    DETECTIONS_PATH: Path = DATA_DIR / "detections"
    EXPORTS_PATH: Path = DATA_DIR / "exports"
    CONFIGS_PATH: Path = CONFIGS_DIR
    
    # Database
    DATABASE_URL: str = f"sqlite:///{BASE_DIR}/traffic_labeling.db"
    
    # Upload limits
    MAX_UPLOAD_SIZE_MB: int = 2048  # 2GB max
    ALLOWED_VIDEO_EXTS: set[str] = {".mp4", ".avi", ".mov", ".mkv"}
    ALLOWED_IMAGE_EXTS: set[str] = {".jpg", ".jpeg", ".png"}

    class Config:
        case_sensitive = True

settings = Settings()
