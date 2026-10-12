# BBox 2D Traffic Labeling Tool (Detector + Tracker)

Hệ thống hỗ trợ gán nhãn dữ liệu video & image sequence giao thông tự động bằng mô hình AI (**YOLOv8 + BoT-SORT / ByteTrack**) kết hợp giao diện chỉnh sửa thủ công (React + Konva) và xuất file annotation theo định dạng chuẩn đề bài.

---

## 1. Cấu trúc thư mục (Monorepo)

```text
Build-Phase/
├── configs/                  # Cấu hình dùng chung giữa FE, BE và AI (Single Source of Truth)
│   ├── classes.json          # 6 class chuẩn (id, tên, mã màu, hotkey, mapping COCO)
│   ├── annotation_schema.json# JSON Schema kiểm tra dữ liệu annotation/export
│   └── sample_annotation.json# Dữ liệu annotation mẫu cho Frontend mock
│
├── backend/                  # Python FastAPI Backend
│   ├── app/
│   │   ├── main.py           # FastAPI app, CORS, routes
│   │   ├── core/config.py    # Cấu hình đường dẫn data, upload limit
│   │   ├── schemas/          # Pydantic models (BBox, Frame, Project)
│   │   └── services/         # Frame extraction service (OpenCV)
│   └── requirements.txt      # Thư viện Backend
│
├── frontend/                 # React 18 + TypeScript + Vite + Konva
│   ├── src/                  # Mã nguồn giao diện labeling
│   └── package.json          # Thư viện Frontend (react-konva, zustand, lucide-react)
│
├── ai/                       # AI Pipeline (YOLOv8 + Tracker Adapter)
│   ├── detector.py           # YOLOv8 Detector wrapper + whitelist 6 class
│   ├── tracker.py            # Tracker Adapter (BoT-SORT mặc định, ByteTrack baseline)
│   └── requirements.txt      # Thư viện AI (ultralytics, torch, opencv)
│
├── data/                     # Thư mục dữ liệu local (không commit file lớn lên git)
│   ├── raw/                  # Video / zip ảnh gốc tải lên
│   ├── frames/               # Frame JPEG tách sẵn (frame_000000.jpg, ...)
│   ├── detections/           # Cache kết quả detection (conf >= 0.1)
│   └── exports/              # File JSON và MOTChallenge xuất ra
│
└── MVP_Backlog_Tracking_BBox2D (1).xlsx # Backlog chi tiết của dự án
```

---

## 2. Quy ước kỹ thuật cốt lõi

* **Hệ tọa độ Bounding Box**: `[x, y, width, height]` theo pixel thực tế của ảnh gốc (gốc tọa độ `(0, 0)` tại góc trên bên trái).
* **Chỉ số Frame (`frame_idx`)**: Đánh số nguyên liên tục bắt đầu từ **`0`** (`0, 1, 2, ...`).
* **Frame JPEG**: Nguồn sự thật duy nhất (Single Source of Truth) được trích xuất sẵn ra thư mục `data/frames/{sample_id}/frame_%06d.jpg`.
* **Track ID**: Số nguyên dương (`1, 2, 3, ...`), không tái sử dụng khi track bị xóa hoặc mất dấu.
* **6 Class đối tượng giao thông**:
  1. `car` (Ô tô) - Hotkey `1`
  2. `bus` (Xe buýt) - Hotkey `2`
  3. `truck` (Xe tải) - Hotkey `3`
  4. `van` (Xe van) - Hotkey `4`
  5. `motorcycle` (Xe máy) - Hotkey `5`
  6. `person` (Người đi bộ) - Hotkey `6`

---

## 3. Hướng dẫn chạy thử nghiệm (Development)

### Backend (FastAPI)
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
API Documentation tự động tại: `http://localhost:8000/docs`

### Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev
```
Giao diện chạy tại: `http://localhost:5173`

---

## 4. Trạng thái hiện tại
* [x] **T-001**: Chốt quy ước tọa độ, data model, cấu trúc Monorepo.
* [x] **T-002**: JSON Schema và sample annotation mẫu cho Frontend mock.
* [x] **T-008**: File cấu hình 6 class dùng chung `configs/classes.json`.
* [x] **T-020**: Service trích xuất frame JPEG từ video bằng OpenCV.
* [x] **T-050 / T-062**: Skeleton Detector YOLOv8 và Tracker Adapter BoT-SORT/ByteTrack.
* [x] Khởi tạo Frontend React + TypeScript + Konva + Zustand.
