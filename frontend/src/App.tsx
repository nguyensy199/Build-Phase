import { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Rect, Text as KonvaText, Group, Image as KonvaImage } from 'react-konva';
import { 
  Play, Pause, SkipBack, SkipForward, Download, 
  Upload, Sparkles, Save, CheckCircle2, AlertCircle, RefreshCw, X, FolderOpen, Film, Images
} from 'lucide-react';
import type { ClassConfig, SampleAnnotationData, BBoxObject } from './types';

const API_BASE = 'http://127.0.0.1:8000/api/v1';

const CLASSES: ClassConfig[] = [
  { id: 0, name: 'car', display_name: 'Ô tô (Car)', color: '#3B82F6', hotkey: '1', coco_id: 2 },
  { id: 1, name: 'bus', display_name: 'Xe buýt (Bus)', color: '#10B981', hotkey: '2', coco_id: 5 },
  { id: 2, name: 'truck', display_name: 'Xe tải (Truck)', color: '#F59E0B', hotkey: '3', coco_id: 7 },
  { id: 3, name: 'van', display_name: 'Xe van (Van)', color: '#8B5CF6', hotkey: '4', coco_id: null },
  { id: 4, name: 'motorcycle', display_name: 'Xe máy (Motorcycle)', color: '#EC4899', hotkey: '5', coco_id: 3 },
  { id: 5, name: 'person', display_name: 'Người đi bộ (Person)', color: '#EF4444', hotkey: '6', coco_id: 0 },
];

export default function App() {
  const [currentSampleId, setCurrentSampleId] = useState<string>('sample_traffic_demo');
  const [availableSamples, setAvailableSamples] = useState<Array<{ sample_id: string, name?: string, type?: string }>>([]);
  const [annotationData, setAnnotationData] = useState<SampleAnnotationData | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null);
  const [activeClass, setActiveClass] = useState<string>('car');
  const [frameImage, setFrameImage] = useState<HTMLImageElement | null>(null);
  
  // Modal & Upload states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadType, setUploadType] = useState<'video' | 'image_sequence'>('video');
  const [uploadFps, setUploadFps] = useState<number>(30);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAutoLabeling, setIsAutoLabeling] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showNotice = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Fetch list of available samples
  const fetchSamplesList = async () => {
    try {
      const res = await fetch(`${API_BASE}/samples`);
      if (res.ok) {
        const list = await res.json();
        setAvailableSamples(list);
      }
    } catch {
      // Backend might be warming up
    }
  };

  // Load annotation data for current sample
  const loadSampleData = async (sampleId: string) => {
    try {
      const res = await fetch(`${API_BASE}/samples/${sampleId}/annotations`);
      if (!res.ok) throw new Error('Không tải được annotation');
      const data: SampleAnnotationData = await res.json();
      setAnnotationData(data);
      setCurrentFrame(0);
      showNotice('success', `Đã tải sample: ${data.info.name || sampleId}`);
    } catch {
      showNotice('error', 'Chưa thể kết nối tới Backend (port 8000).');
    }
  };

  useEffect(() => {
    fetchSamplesList();
  }, []);

  useEffect(() => {
    loadSampleData(currentSampleId);
  }, [currentSampleId]);

  // Load real frame JPEG
  useEffect(() => {
    if (!annotationData) return;
    const img = new window.Image();
    img.crossOrigin = 'Anonymous';
    img.src = `${API_BASE}/samples/${currentSampleId}/frames/${currentFrame}`;
    img.onload = () => {
      setFrameImage(img);
    };
    img.onerror = () => {
      setFrameImage(null);
    };
  }, [currentSampleId, currentFrame, annotationData]);

  // Frame playback loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isPlaying && annotationData) {
      interval = setInterval(() => {
        setCurrentFrame((prev) => {
          if (prev >= annotationData.info.frame_count - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1000 / annotationData.info.fps);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, annotationData]);

  // Canvas scaling
  const canvasWidth = 960;
  const canvasHeight = 540;
  const origWidth = annotationData?.info.width || 1280;
  const scale = canvasWidth / origWidth;

  const frameObj = annotationData?.frames.find((f) => f.frame === currentFrame);
  const currentObjects: BBoxObject[] = frameObj ? frameObj.objects : [];

  // Submit Upload Form (handles both Video and Image Sequence)
  const handleSubmitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      showNotice('error', 'Vui lòng chọn file để tải lên');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      let endpoint = `${API_BASE}/upload`;
      if (uploadType === 'image_sequence') {
        endpoint = `${API_BASE}/upload-images`;
        formData.append('fps', uploadFps.toString());
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Upload thất bại');
      }

      const data = await res.json();
      setShowUploadModal(false);
      setSelectedFile(null);
      await fetchSamplesList();
      setCurrentSampleId(data.sample_id);
      showNotice('success', `Tải lên thành công! Đã trích xuất ${data.frame_count} frames.`);
    } catch (err: any) {
      showNotice('error', err.message || 'Lỗi khi upload');
    } finally {
      setIsUploading(false);
    }
  };

  // Run AI Auto-Label
  const handleAutoLabel = async () => {
    if (!annotationData) return;
    setIsAutoLabeling(true);
    try {
      const res = await fetch(`${API_BASE}/samples/${currentSampleId}/auto-label?tracker_type=botsort&conf=0.25`, {
        method: 'POST'
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Lỗi auto-label');
      }
      const result = await res.json();
      setAnnotationData(result.annotation);
      showNotice('success', `Hoàn tất Auto-label! Đã gán nhãn cho ${result.total_frames_tracked} frames.`);
    } catch (err: any) {
      showNotice('error', err.message || 'Lỗi khi chạy AI auto-label');
    } finally {
      setIsAutoLabeling(false);
    }
  };

  // Drag BBox handler (Human-in-the-loop)
  const handleBoxDragEnd = (trackId: number, e: any) => {
    if (!annotationData) return;
    const newX = e.target.x() / scale;
    const newY = e.target.y() / scale;

    const updatedFrames = annotationData.frames.map((f) => {
      if (f.frame !== currentFrame) return f;
      return {
        ...f,
        objects: f.objects.map((obj) => {
          if (obj.track_id !== trackId) return obj;
          return {
            ...obj,
            bbox: [Math.max(0, newX), Math.max(0, newY), obj.bbox[2], obj.bbox[3]] as [number, number, number, number],
            source: 'edited' as const
          };
        })
      };
    });

    setAnnotationData({
      ...annotationData,
      frames: updatedFrames
    });
  };

  // Save annotations to Backend
  const handleSaveToBackend = async () => {
    if (!annotationData) return;
    try {
      const res = await fetch(`${API_BASE}/samples/${currentSampleId}/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(annotationData)
      });
      if (!res.ok) throw new Error('Lỗi khi lưu');
      showNotice('success', 'Đã lưu các chỉnh sửa vào database!');
    } catch (err: any) {
      showNotice('error', err.message || 'Lỗi lưu dữ liệu');
    }
  };

  // Export JSON
  const handleExportJSON = () => {
    if (!annotationData) return;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(annotationData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${annotationData.info.sample_id}_groundtruth.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const getClassColor = (className: string) => {
    const found = CLASSES.find(c => c.name === className);
    return found ? found.color : '#3B82F6';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#0f172a' }}>
      {/* Top Header */}
      <header style={{
        height: '56px',
        borderBottom: '1px solid #334155',
        backgroundColor: '#1e293b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            padding: '6px 12px',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '14px',
            color: '#fff',
            letterSpacing: '0.5px'
          }}>
            BBox2D Traffic Studio
          </div>
          <span style={{ color: '#475569' }}>|</span>

          {/* Sample Switcher Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FolderOpen size={16} color="#94a3b8" />
            <select
              value={currentSampleId}
              onChange={(e) => setCurrentSampleId(e.target.value)}
              style={{
                backgroundColor: '#0f172a',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              <option value="sample_traffic_demo">Video mẫu (120 frames)</option>
              {availableSamples
                .filter(s => s.sample_id !== 'sample_traffic_demo')
                .map(s => (
                  <option key={s.sample_id} value={s.sample_id}>
                    {s.name || s.sample_id} ({s.type === 'image_sequence' ? 'Chuỗi ảnh' : 'Video'})
                  </option>
                ))}
            </select>
          </div>

          {annotationData && (
            <span style={{
              fontSize: '12px',
              backgroundColor: '#334155',
              color: '#38bdf8',
              padding: '2px 8px',
              borderRadius: '4px'
            }}>
              {annotationData.info.width}x{annotationData.info.height} · {annotationData.info.fps} FPS · {annotationData.info.frame_count} frames
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Open Upload Modal Button */}
          <button
            onClick={() => setShowUploadModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#334155',
              color: '#f8fafc',
              border: '1px solid #475569',
              padding: '6px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '13px'
            }}
          >
            <Upload size={14} />
            1. Upload Video / Chuỗi ảnh (T-017)
          </button>

          {/* Auto-Label Button */}
          <button
            onClick={handleAutoLabel}
            disabled={isAutoLabeling}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#7c3aed',
              color: '#ffffff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              cursor: isAutoLabeling ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: '13px'
            }}
          >
            <Sparkles size={14} />
            {isAutoLabeling ? 'AI Đang chạy...' : '2. Auto-label (AI)'}
          </button>

          {/* Save Button */}
          <button
            onClick={handleSaveToBackend}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#059669',
              color: '#ffffff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '13px'
            }}
          >
            <Save size={14} />
            Lưu sửa đổi
          </button>

          {/* Export JSON Button */}
          <button
            onClick={handleExportJSON}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '13px'
            }}
          >
            <Download size={14} />
            Export Ground Truth
          </button>
        </div>
      </header>

      {/* Upload Dialog Modal (T-017) */}
      {showUploadModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            width: '500px',
            backgroundColor: '#1e293b',
            borderRadius: '12px',
            border: '1px solid #475569',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid #334155'
            }}>
              <span style={{ fontWeight: 600, fontSize: '15px', color: '#f8fafc' }}>
                Tải lên dữ liệu mới (Video / Chuỗi ảnh)
              </span>
              <button
                onClick={() => setShowUploadModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmitUpload} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Type Switcher Tabs */}
              <div style={{ display: 'flex', gap: '8px', backgroundColor: '#0f172a', padding: '4px', borderRadius: '8px' }}>
                <button
                  type="button"
                  onClick={() => { setUploadType('video'); setSelectedFile(null); }}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 600,
                    backgroundColor: uploadType === 'video' ? '#2563eb' : 'transparent',
                    color: uploadType === 'video' ? '#fff' : '#94a3b8'
                  }}
                >
                  <Film size={15} /> Video (.mp4, .avi, .mov)
                </button>
                <button
                  type="button"
                  onClick={() => { setUploadType('image_sequence'); setSelectedFile(null); }}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 600,
                    backgroundColor: uploadType === 'image_sequence' ? '#2563eb' : 'transparent',
                    color: uploadType === 'image_sequence' ? '#fff' : '#94a3b8'
                  }}
                >
                  <Images size={15} /> Chuỗi ảnh ZIP (.zip)
                </button>
              </div>

              {/* File Drop / Select Area */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed #475569',
                  borderRadius: '8px',
                  padding: '24px 16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  backgroundColor: '#0f172a'
                }}
              >
                <Upload size={28} color="#38bdf8" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 500 }}>
                  {selectedFile ? selectedFile.name : `Bấm để chọn file ${uploadType === 'video' ? 'Video' : 'ZIP chuỗi ảnh'}`}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  {uploadType === 'video' 
                    ? 'Hỗ trợ .mp4, .avi, .mov (tối đa 2GB)' 
                    : 'Đóng gói các ảnh .jpg, .png cùng kích thước vào 1 file .zip'}
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => {
                    if (e.target.files?.[0]) setSelectedFile(e.target.files[0]);
                  }}
                  accept={uploadType === 'video' ? 'video/mp4,video/avi,video/quicktime' : '.zip,application/zip'}
                  style={{ display: 'none' }}
                />
              </div>

              {/* Extra input for FPS if Image Sequence */}
              {uploadType === 'image_sequence' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>
                    Tốc độ khung hình (FPS) cho chuỗi ảnh (Quy ước A-08):
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={uploadFps}
                    onChange={(e) => setUploadFps(Number(e.target.value))}
                    style={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      color: '#f8fafc',
                      fontSize: '13px'
                    }}
                  />
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    * Chuỗi ảnh không có sẵn FPS, hệ thống sẽ gán giá trị này làm metadata cho mẫu.
                  </span>
                </div>
              )}

              {/* Submit Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  style={{
                    backgroundColor: '#334155',
                    border: 'none',
                    color: '#f8fafc',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isUploading || !selectedFile}
                  style={{
                    backgroundColor: '#2563eb',
                    border: 'none',
                    color: '#ffffff',
                    padding: '8px 20px',
                    borderRadius: '6px',
                    cursor: (isUploading || !selectedFile) ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {isUploading && <RefreshCw size={14} className="animate-spin" />}
                  {isUploading ? 'Đang trích xuất frame...' : 'Bắt đầu Tải lên'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '64px',
          right: '20px',
          backgroundColor: notification.type === 'success' ? '#065f46' : '#991b1b',
          color: '#ffffff',
          padding: '10px 16px',
          borderRadius: '8px',
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 100
        }}>
          {notification.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {notification.message}
        </div>
      )}

      {/* Main Studio Area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Toolbar: 6 Classes */}
        <aside style={{
          width: '240px',
          backgroundColor: '#1e293b',
          borderRight: '1px solid #334155',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Classes (6 nhãn)
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {CLASSES.map((cls) => {
              const isActive = activeClass === cls.name;
              return (
                <button
                  key={cls.id}
                  onClick={() => setActiveClass(cls.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: isActive ? `2px solid ${cls.color}` : '1px solid #334155',
                    backgroundColor: isActive ? '#334155' : '#0f172a',
                    color: '#f8fafc',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: cls.color }} />
                    <span>{cls.display_name}</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b', backgroundColor: '#1e293b', padding: '2px 6px', borderRadius: '4px' }}>
                    [{cls.hotkey}]
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 'auto', padding: '12px', backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 600 }}>
              💡 Mẹo tương tác:
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px', lineHeight: 1.5 }}>
              • <b>Kéo thả box</b>: Bấm giữ và kéo để sửa vị trí bị lệch của AI.<br />
              • <b>Đổi class/track</b>: Chọn item ở danh sách bên phải.
            </div>
          </div>
        </aside>

        {/* Center: Konva Canvas Viewport */}
        <main style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#090d16',
          padding: '16px'
        }}>
          <div style={{
            border: '2px solid #334155',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            position: 'relative',
            width: canvasWidth,
            height: canvasHeight
          }}>
            <Stage width={canvasWidth} height={canvasHeight}>
              <Layer>
                {frameImage ? (
                  <KonvaImage
                    image={frameImage}
                    width={canvasWidth}
                    height={canvasHeight}
                  />
                ) : (
                  <Rect
                    x={0}
                    y={0}
                    width={canvasWidth}
                    height={canvasHeight}
                    fill="#141e30"
                  />
                )}

                {currentObjects.map((obj) => {
                  const [x, y, w, h] = obj.bbox;
                  const color = getClassColor(obj.class);
                  const isSelected = selectedTrackId === obj.track_id;

                  return (
                    <Group
                      key={obj.track_id}
                      x={x * scale}
                      y={y * scale}
                      draggable={true}
                      onDragEnd={(e) => handleBoxDragEnd(obj.track_id, e)}
                      onClick={() => setSelectedTrackId(obj.track_id)}
                    >
                      <Rect
                        x={0}
                        y={0}
                        width={w * scale}
                        height={h * scale}
                        stroke={color}
                        strokeWidth={isSelected ? 3 : 2}
                        fill={isSelected ? `${color}40` : `${color}15`}
                        cornerRadius={2}
                      />

                      <Rect
                        x={0}
                        y={-22}
                        width={130}
                        height={20}
                        fill={color}
                        cornerRadius={2}
                      />
                      <KonvaText
                        x={6}
                        y={-18}
                        text={`#${obj.track_id} ${obj.class} (${Math.round((obj.confidence || 0) * 100)}%)`}
                        fontSize={11}
                        fill="#ffffff"
                        fontStyle="bold"
                      />
                    </Group>
                  );
                })}
              </Layer>
            </Stage>
          </div>
        </main>

        {/* Right Inspector: Track List & Human Verification */}
        <aside style={{
          width: '280px',
          backgroundColor: '#1e293b',
          borderLeft: '1px solid #334155',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Objects tại Frame {currentFrame} ({currentObjects.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
            {currentObjects.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#64748b', textAlign: 'center', marginTop: '20px' }}>
                Không có object nào ở frame này
              </div>
            ) : (
              currentObjects.map((obj) => {
                const isSelected = selectedTrackId === obj.track_id;
                const color = getClassColor(obj.class);

                return (
                  <div
                    key={obj.track_id}
                    onClick={() => setSelectedTrackId(obj.track_id)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '6px',
                      border: isSelected ? `2px solid ${color}` : '1px solid #334155',
                      backgroundColor: isSelected ? '#334155' : '#0f172a',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600, fontSize: '13px', color: color }}>
                        Track #{obj.track_id} · {obj.class}
                      </span>
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: obj.source === 'edited' ? '#d97706' : '#1e293b',
                        color: obj.source === 'edited' ? '#fff' : '#94a3b8'
                      }}>
                        {obj.source}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      x:{Math.round(obj.bbox[0])} y:{Math.round(obj.bbox[1])} w:{Math.round(obj.bbox[2])} h:{Math.round(obj.bbox[3])}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>

      {/* Bottom Timeline Controls */}
      <footer style={{
        height: '64px',
        backgroundColor: '#1e293b',
        borderTop: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: '20px'
      }}>
        {/* Playback buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setCurrentFrame(prev => Math.max(0, prev - 1))}
            style={{
              background: '#334155',
              border: 'none',
              color: '#f8fafc',
              padding: '8px',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            <SkipBack size={16} />
          </button>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            style={{
              background: '#2563eb',
              border: 'none',
              color: '#ffffff',
              padding: '8px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600,
              fontSize: '13px'
            }}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          <button
            onClick={() => setCurrentFrame(prev => Math.min((annotationData?.info.frame_count || 1) - 1, prev + 1))}
            style={{
              background: '#334155',
              border: 'none',
              color: '#f8fafc',
              padding: '8px',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            <SkipForward size={16} />
          </button>
        </div>

        {/* Frame Progress Slider */}
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: '12px' }}>
          <input
            type="range"
            min={0}
            max={(annotationData?.info.frame_count || 1) - 1}
            value={currentFrame}
            onChange={(e) => setCurrentFrame(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#3b82f6', cursor: 'pointer' }}
          />
        </div>

        {/* Frame Display */}
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', minWidth: '120px', textAlign: 'right' }}>
          Frame: <span style={{ color: '#38bdf8' }}>{currentFrame}</span> / {(annotationData?.info.frame_count || 1) - 1}
        </div>
      </footer>
    </div>
  );
}
