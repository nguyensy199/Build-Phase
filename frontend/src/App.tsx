import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Stage, Layer, Rect, Text as KonvaText, Group, Image as KonvaImage, Transformer, Line, Circle } from 'react-konva';
import { 
  Play, Pause, SkipBack, SkipForward, Download, 
  Upload, Sparkles, Save, CheckCircle2, AlertCircle, RefreshCw, X, FolderOpen, Film, Images,
  Trash2, MousePointer, PlusCircle, Undo2, Redo2, 
  GitMerge, Edit3, Eye, EyeOff, Waypoints, BoxSelect
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
  
  // History stack for Undo/Redo (T-090)
  const [history, setHistory] = useState<SampleAnnotationData[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null);
  const [activeClass, setActiveClass] = useState<string>('car');
  const [frameImage, setFrameImage] = useState<HTMLImageElement | null>(null);
  
  // View mode: 'track' (video tracking with ID) vs 'shape' (static BBox for images)
  const [annotationMode, setAnnotationMode] = useState<'track' | 'shape'>('track');
  
  // Right sidebar tab: 'frame' objects vs 'all_tracks' overview
  const [rightTab, setRightTab] = useState<'frame' | 'tracks'>('frame');

  // Motion trail toggle (T-107)
  const [showMotionTrail, setShowMotionTrail] = useState<boolean>(true);

  // Tool mode: 'select' vs 'draw'
  const [toolMode, setToolMode] = useState<'select' | 'draw'>('select');
  const [newBoxStart, setNewBoxStart] = useState<{ x: number, y: number } | null>(null);
  const [newBoxCurrent, setNewBoxCurrent] = useState<{ x: number, y: number } | null>(null);

  // Rename Track Modal states (T-101)
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<number>(1);
  const [renameScope, setRenameScope] = useState<'current' | 'onwards' | 'all'>('onwards');

  // Merge Track Modal states (T-102)
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState<number | null>(null);
  const [mergeDestId, setMergeDestId] = useState<number | null>(null);

  // Upload Modal states (T-017)
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadType, setUploadType] = useState<'video' | 'image_sequence'>('video');
  const [uploadFps, setUploadFps] = useState<number>(30);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAutoLabeling, setIsAutoLabeling] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);
  const shapeRefs = useRef<Map<number, any>>(new Map());

  const showNotice = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  const updateDataWithHistory = useCallback((newData: SampleAnnotationData) => {
    setAnnotationData(newData);
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, newData];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setAnnotationData(history[prevIndex]);
      showNotice('success', 'Đã Undo (Hoàn tác)');
    }
  }, [historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setAnnotationData(history[nextIndex]);
      showNotice('success', 'Đã Redo (Làm lại)');
    }
  }, [historyIndex, history]);

  const fetchSamplesList = async () => {
    try {
      const res = await fetch(`${API_BASE}/samples`);
      if (res.ok) {
        const list = await res.json();
        setAvailableSamples(list);
      }
    } catch {
      // Backend warming up
    }
  };

  const loadSampleData = async (sampleId: string) => {
    try {
      const res = await fetch(`${API_BASE}/samples/${sampleId}/annotations`);
      if (!res.ok) throw new Error('Không tải được annotation');
      const data: SampleAnnotationData = await res.json();
      setAnnotationData(data);
      setHistory([data]);
      setHistoryIndex(0);
      setCurrentFrame(0);
      setSelectedTrackId(null);
      // Auto switch to shape mode if sample is image_sequence with 1 frame, or default to track mode
      if (data.info.type === 'image_sequence' && data.info.frame_count <= 1) {
        setAnnotationMode('shape');
      } else {
        setAnnotationMode('track');
      }
      showNotice('success', `Đã tải: ${data.info.name || sampleId}`);
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

  // Transformer binding for selected box (T-086)
  useEffect(() => {
    if (selectedTrackId && transformerRef.current) {
      const selectedNode = shapeRefs.current.get(selectedTrackId);
      if (selectedNode) {
        transformerRef.current.nodes([selectedNode]);
        transformerRef.current.getLayer().batchDraw();
      } else {
        transformerRef.current.nodes([]);
      }
    } else if (transformerRef.current) {
      transformerRef.current.nodes([]);
    }
  }, [selectedTrackId, currentFrame, currentObjects]);

  // Next unique track ID (non-reusable)
  const getNextTrackId = (): number => {
    if (!annotationData) return 1;
    let maxId = 0;
    for (const f of annotationData.frames) {
      for (const obj of f.objects) {
        if (obj.track_id > maxId) maxId = obj.track_id;
      }
    }
    return maxId + 1;
  };

  // Compute all tracks summary across entire sample
  const allTracksSummary = useMemo(() => {
    if (!annotationData) return [];
    const trackMap = new Map<number, { track_id: number, class: string, frameCount: number, firstFrame: number, lastFrame: number }>();
    annotationData.frames.forEach(f => {
      f.objects.forEach(obj => {
        const existing = trackMap.get(obj.track_id);
        if (!existing) {
          trackMap.set(obj.track_id, {
            track_id: obj.track_id,
            class: obj.class,
            frameCount: 1,
            firstFrame: f.frame,
            lastFrame: f.frame
          });
        } else {
          existing.frameCount += 1;
          existing.lastFrame = Math.max(existing.lastFrame, f.frame);
        }
      });
    });
    return Array.from(trackMap.values()).sort((a, b) => a.track_id - b.track_id);
  }, [annotationData]);

  // Compute Motion Trail for the selected track (T-107)
  const selectedTrackTrajectory = useMemo(() => {
    if (!annotationData || !selectedTrackId || !showMotionTrail || annotationMode !== 'track') return [];
    const points: Array<{ frame: number, x: number, y: number }> = [];
    annotationData.frames.forEach(f => {
      const obj = f.objects.find(o => o.track_id === selectedTrackId);
      if (obj) {
        const [x, y, w, h] = obj.bbox;
        const centerX = (x + w / 2) * scale;
        const centerY = (y + h / 2) * scale;
        points.push({ frame: f.frame, x: centerX, y: centerY });
      }
    });
    return points;
  }, [annotationData, selectedTrackId, showMotionTrail, annotationMode, scale]);

  // Flattened points array for Konva Line: [x1, y1, x2, y2, ...]
  const trajectoryLinePoints = useMemo(() => {
    const flat: number[] = [];
    selectedTrackTrajectory.forEach(p => {
      flat.push(p.x, p.y);
    });
    return flat;
  }, [selectedTrackTrajectory]);

  // Delete selected BBox / Shape (T-088)
  const handleDeleteSelectedBox = useCallback(() => {
    if (!annotationData || selectedTrackId === null) return;
    const updatedFrames = annotationData.frames.map((f) => {
      if (f.frame !== currentFrame) return f;
      return {
        ...f,
        objects: f.objects.filter((obj) => obj.track_id !== selectedTrackId)
      };
    });
    updateDataWithHistory({
      ...annotationData,
      frames: updatedFrames
    });
    setSelectedTrackId(null);
    showNotice('success', `Đã xóa đối tượng #${selectedTrackId} tại frame ${currentFrame}`);
  }, [annotationData, selectedTrackId, currentFrame, updateDataWithHistory]);

  // Delete WHOLE Track across all frames (T-104)
  const handleDeleteWholeTrack = useCallback((trackIdToDelete: number) => {
    if (!annotationData) return;
    const updatedFrames = annotationData.frames.map((f) => ({
      ...f,
      objects: f.objects.filter((obj) => obj.track_id !== trackIdToDelete)
    }));
    updateDataWithHistory({
      ...annotationData,
      frames: updatedFrames
    });
    if (selectedTrackId === trackIdToDelete) setSelectedTrackId(null);
    showNotice('success', `Đã xóa toàn bộ Track #${trackIdToDelete} khỏi video`);
  }, [annotationData, selectedTrackId, updateDataWithHistory]);

  // Rename Track ID with 3 Scopes (T-101)
  const handleExecuteRenameTrack = () => {
    if (!annotationData || selectedTrackId === null) return;
    if (renameTargetId <= 0) {
      showNotice('error', 'Track ID mới phải là số nguyên dương');
      return;
    }

    const updatedFrames = annotationData.frames.map((f) => {
      let shouldUpdate = false;
      if (renameScope === 'current' && f.frame === currentFrame) shouldUpdate = true;
      if (renameScope === 'onwards' && f.frame >= currentFrame) shouldUpdate = true;
      if (renameScope === 'all') shouldUpdate = true;

      if (!shouldUpdate) return f;

      return {
        ...f,
        objects: f.objects.map((obj) => {
          if (obj.track_id !== selectedTrackId) return obj;
          return {
            ...obj,
            track_id: renameTargetId,
            source: 'edited' as const
          };
        })
      };
    });

    updateDataWithHistory({
      ...annotationData,
      frames: updatedFrames
    });
    setSelectedTrackId(renameTargetId);
    setShowRenameModal(false);
    showNotice('success', `Đã đổi Track #${selectedTrackId} ➔ #${renameTargetId} (${renameScope === 'current' ? 'Chỉ frame này' : renameScope === 'onwards' ? 'Từ frame này về sau' : 'Toàn clip'})`);
  };

  // Merge Tracks (T-102)
  const handleExecuteMergeTrack = () => {
    if (!annotationData || mergeSourceId === null || mergeDestId === null) return;
    if (mergeSourceId === mergeDestId) {
      showNotice('error', 'Không thể merge 1 track vào chính nó');
      return;
    }

    const updatedFrames = annotationData.frames.map((f) => {
      // Check if both exist in the same frame
      const hasDest = f.objects.some(obj => obj.track_id === mergeDestId);
      return {
        ...f,
        objects: f.objects.map((obj) => {
          if (obj.track_id !== mergeSourceId) return obj;
          // If destination already exists in this frame, keep dest, or reassign
          if (hasDest) return obj;
          return {
            ...obj,
            track_id: mergeDestId,
            source: 'edited' as const
          };
        }).filter(obj => !(hasDest && obj.track_id === mergeSourceId))
      };
    });

    updateDataWithHistory({
      ...annotationData,
      frames: updatedFrames
    });
    setSelectedTrackId(mergeDestId);
    setShowMergeModal(false);
    showNotice('success', `Đã gộp Track #${mergeSourceId} vào Track #${mergeDestId}`);
  };

  // Change class of selected BBox (T-089)
  const handleChangeSelectedClass = useCallback((newClassName: string) => {
    if (!annotationData || selectedTrackId === null) return;
    const updatedFrames = annotationData.frames.map((f) => {
      if (f.frame !== currentFrame) return f;
      return {
        ...f,
        objects: f.objects.map((obj) => {
          if (obj.track_id !== selectedTrackId) return obj;
          return {
            ...obj,
            class: newClassName,
            source: 'edited' as const
          };
        })
      };
    });
    updateDataWithHistory({
      ...annotationData,
      frames: updatedFrames
    });
    setActiveClass(newClassName);
    showNotice('success', `Đã đổi class #${selectedTrackId} sang ${newClassName}`);
  }, [annotationData, selectedTrackId, currentFrame, updateDataWithHistory]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteSelectedBox();
      }

      const hotkeyClass = CLASSES.find(c => c.hotkey === e.key);
      if (hotkeyClass) {
        e.preventDefault();
        setActiveClass(hotkeyClass.name);
        if (selectedTrackId !== null) {
          handleChangeSelectedClass(hotkeyClass.name);
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }

      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        handleRedo();
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(prev => !prev);
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentFrame(prev => Math.max(0, prev - 1));
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCurrentFrame(prev => Math.min((annotationData?.info.frame_count || 1) - 1, prev + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDeleteSelectedBox, handleChangeSelectedClass, handleUndo, handleRedo, selectedTrackId, annotationData]);

  // Stage Mouse Handlers for Drawing New BBox (T-087)
  const handleStageMouseDown = (e: any) => {
    if (toolMode !== 'draw') {
      if (e.target === e.target.getStage()) {
        setSelectedTrackId(null);
      }
      return;
    }
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (pos) {
      setNewBoxStart({ x: pos.x, y: pos.y });
      setNewBoxCurrent({ x: pos.x, y: pos.y });
    }
  };

  const handleStageMouseMove = (e: any) => {
    if (toolMode !== 'draw' || !newBoxStart) return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (pos) {
      setNewBoxCurrent({ x: pos.x, y: pos.y });
    }
  };

  const handleStageMouseUp = () => {
    if (toolMode !== 'draw' || !newBoxStart || !newBoxCurrent || !annotationData) {
      setNewBoxStart(null);
      setNewBoxCurrent(null);
      return;
    }

    const x1 = Math.min(newBoxStart.x, newBoxCurrent.x);
    const y1 = Math.min(newBoxStart.y, newBoxCurrent.y);
    const w = Math.abs(newBoxCurrent.x - newBoxStart.x);
    const h = Math.abs(newBoxCurrent.y - newBoxStart.y);

    setNewBoxStart(null);
    setNewBoxCurrent(null);

    if (w > 10 && h > 10) {
      const origX = x1 / scale;
      const origY = y1 / scale;
      const origW = w / scale;
      const origH = h / scale;

      const newTrackId = getNextTrackId();
      const newObj: BBoxObject = {
        track_id: newTrackId,
        class: activeClass,
        bbox: [Math.round(origX), Math.round(origY), Math.round(origW), Math.round(origH)],
        confidence: 1.0,
        source: 'manual'
      };

      const updatedFrames = annotationData.frames.map((f) => {
        if (f.frame !== currentFrame) return f;
        return {
          ...f,
          objects: [...f.objects, newObj]
        };
      });

      updateDataWithHistory({
        ...annotationData,
        frames: updatedFrames
      });

      setSelectedTrackId(newTrackId);
      setToolMode('select');
      showNotice('success', `Đã thêm mới: #${newTrackId} (${activeClass})`);
    }
  };

  // Drag End handler (T-085)
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
            bbox: [Math.max(0, Math.round(newX)), Math.max(0, Math.round(newY)), obj.bbox[2], obj.bbox[3]] as [number, number, number, number],
            source: 'edited' as const
          };
        })
      };
    });

    updateDataWithHistory({
      ...annotationData,
      frames: updatedFrames
    });
  };

  // Transform / Resize End handler (T-086)
  const handleBoxTransformEnd = (trackId: number) => {
    if (!annotationData) return;
    const node = shapeRefs.current.get(trackId);
    if (!node) return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    const newX = Math.max(0, Math.round(node.x() / scale));
    const newY = Math.max(0, Math.round(node.y() / scale));
    const newW = Math.max(5, Math.round((node.width() * scaleX) / scale));
    const newH = Math.max(5, Math.round((node.height() * scaleY) / scale));

    const updatedFrames = annotationData.frames.map((f) => {
      if (f.frame !== currentFrame) return f;
      return {
        ...f,
        objects: f.objects.map((obj) => {
          if (obj.track_id !== trackId) return obj;
          return {
            ...obj,
            bbox: [newX, newY, newW, newH] as [number, number, number, number],
            source: 'edited' as const
          };
        })
      };
    });

    updateDataWithHistory({
      ...annotationData,
      frames: updatedFrames
    });
    showNotice('success', `Đã resize đối tượng #${trackId}`);
  };

  // Upload Form handler
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
      updateDataWithHistory(result.annotation);
      showNotice('success', `Hoàn tất Auto-label! Đã gán nhãn cho ${result.total_frames_tracked} frames.`);
    } catch (err: any) {
      showNotice('error', err.message || 'Lỗi khi chạy AI auto-label');
    } finally {
      setIsAutoLabeling(false);
    }
  };

  // Save to Backend
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

  const selectedObject = currentObjects.find(obj => obj.track_id === selectedTrackId);

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

          {/* Mode Selector: Track vs Shape */}
          <div style={{
            display: 'flex',
            backgroundColor: '#0f172a',
            padding: '3px',
            borderRadius: '8px',
            border: '1px solid #334155'
          }}>
            <button
              onClick={() => setAnnotationMode('track')}
              title="Chế độ Track: Dành cho Video có liên kết thời gian & ID theo vết"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '5px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: annotationMode === 'track' ? '#3b82f6' : 'transparent',
                color: annotationMode === 'track' ? '#fff' : '#94a3b8'
              }}
            >
              <Waypoints size={13} /> Chế độ Track (Video)
            </button>
            <button
              onClick={() => setAnnotationMode('shape')}
              title="Chế độ Shape: Dành cho Ảnh tĩnh đơn lập, BBox độc lập"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '5px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: annotationMode === 'shape' ? '#10b981' : 'transparent',
                color: annotationMode === 'shape' ? '#fff' : '#94a3b8'
              }}
            >
              <BoxSelect size={13} /> Chế độ Shape (Ảnh)
            </button>
          </div>

          <span style={{ color: '#475569' }}>|</span>

          {/* Sample Switcher */}
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
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Undo / Redo */}
          <button
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            title="Hoàn tác (Ctrl+Z)"
            style={{
              backgroundColor: '#334155',
              color: historyIndex <= 0 ? '#64748b' : '#f8fafc',
              border: '1px solid #475569',
              padding: '6px 8px',
              borderRadius: '6px',
              cursor: historyIndex <= 0 ? 'not-allowed' : 'pointer'
            }}
          >
            <Undo2 size={15} />
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            title="Làm lại (Ctrl+Y)"
            style={{
              backgroundColor: '#334155',
              color: historyIndex >= history.length - 1 ? '#64748b' : '#f8fafc',
              border: '1px solid #475569',
              padding: '6px 8px',
              borderRadius: '6px',
              cursor: historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer'
            }}
          >
            <Redo2 size={15} />
          </button>

          <span style={{ color: '#475569' }}>|</span>

          {/* Upload Button */}
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
            <Upload size={14} /> Upload Video / ZIP
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
            {isAutoLabeling ? 'AI Đang chạy...' : 'Auto-label (AI)'}
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
            <Save size={14} /> Lưu
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
            <Download size={14} /> Export JSON
          </button>
        </div>
      </header>

      {/* Rename Track Modal (T-101) */}
      {showRenameModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            width: '420px',
            backgroundColor: '#1e293b',
            borderRadius: '12px',
            border: '1px solid #475569',
            padding: '20px',
            display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: '15px', color: '#f8fafc' }}>
                Đổi Track ID (Sửa ID Switch - T-101)
              </span>
              <button onClick={() => setShowRenameModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: '13px', color: '#94a3b8' }}>
              Đang chọn Track hiện tại: <b style={{ color: '#38bdf8' }}>#{selectedTrackId}</b>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>Track ID mới:</label>
              <input
                type="number"
                min="1"
                value={renameTargetId}
                onChange={(e) => setRenameTargetId(Number(e.target.value))}
                style={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #475569',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  color: '#f8fafc',
                  fontSize: '14px'
                }}
              />
            </div>

            {/* Scope Selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>Phạm vi áp dụng:</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#f8fafc', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="scope"
                  checked={renameScope === 'onwards'}
                  onChange={() => setRenameScope('onwards')}
                />
                <b>Từ frame này trở về sau ({currentFrame} ➔ hết)</b> - Sửa ID switch
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#cbd5e1', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="scope"
                  checked={renameScope === 'current'}
                  onChange={() => setRenameScope('current')}
                />
                Chỉ ở frame hiện tại ({currentFrame})
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#cbd5e1', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="scope"
                  checked={renameScope === 'all'}
                  onChange={() => setRenameScope('all')}
                />
                Toàn bộ video (Tất cả frame của track #{selectedTrackId})
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button
                onClick={() => setShowRenameModal(false)}
                style={{ backgroundColor: '#334155', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer' }}
              >
                Hủy
              </button>
              <button
                onClick={handleExecuteRenameTrack}
                style={{ backgroundColor: '#2563eb', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
              >
                Xác nhận đổi ID
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Track Modal (T-102) */}
      {showMergeModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            width: '440px',
            backgroundColor: '#1e293b',
            borderRadius: '12px',
            border: '1px solid #475569',
            padding: '20px',
            display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: '15px', color: '#f8fafc' }}>
                Gộp 2 Track (Merge Tracks - T-102)
              </span>
              <button onClick={() => setShowMergeModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              Dùng khi 1 xe bị che khuất và xuất hiện lại bị gán thành ID mới. Gộp 2 track lại thành một.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Track nguồn (sẽ bị gộp):</label>
              <select
                value={mergeSourceId || ''}
                onChange={(e) => setMergeSourceId(Number(e.target.value))}
                style={{ backgroundColor: '#0f172a', color: '#fff', border: '1px solid #475569', padding: '8px', borderRadius: '6px' }}
              >
                {allTracksSummary.map(t => (
                  <option key={t.track_id} value={t.track_id}>Track #{t.track_id} ({t.class} - {t.frameCount} frames)</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Gộp vào Track đích:</label>
              <select
                value={mergeDestId || ''}
                onChange={(e) => setMergeDestId(Number(e.target.value))}
                style={{ backgroundColor: '#0f172a', color: '#fff', border: '1px solid #475569', padding: '8px', borderRadius: '6px' }}
              >
                {allTracksSummary.filter(t => t.track_id !== mergeSourceId).map(t => (
                  <option key={t.track_id} value={t.track_id}>Track #{t.track_id} ({t.class} - {t.frameCount} frames)</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button
                onClick={() => setShowMergeModal(false)}
                style={{ backgroundColor: '#334155', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer' }}
              >
                Hủy
              </button>
              <button
                onClick={handleExecuteMergeTrack}
                style={{ backgroundColor: '#7c3aed', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
              >
                Gộp 2 Track
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Dialog Modal (T-017) */}
      {showUploadModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #334155' }}>
              <span style={{ fontWeight: 600, fontSize: '15px', color: '#f8fafc' }}>
                Tải lên dữ liệu mới (Video / Chuỗi ảnh)
              </span>
              <button onClick={() => setShowUploadModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitUpload} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', backgroundColor: '#0f172a', padding: '4px', borderRadius: '8px' }}>
                <button
                  type="button"
                  onClick={() => { setUploadType('video'); setSelectedFile(null); }}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px',
                    borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    backgroundColor: uploadType === 'video' ? '#2563eb' : 'transparent', color: uploadType === 'video' ? '#fff' : '#94a3b8'
                  }}
                >
                  <Film size={15} /> Video (.mp4, .avi, .mov)
                </button>
                <button
                  type="button"
                  onClick={() => { setUploadType('image_sequence'); setSelectedFile(null); }}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px',
                    borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    backgroundColor: uploadType === 'image_sequence' ? '#2563eb' : 'transparent', color: uploadType === 'image_sequence' ? '#fff' : '#94a3b8'
                  }}
                >
                  <Images size={15} /> Chuỗi ảnh ZIP (.zip)
                </button>
              </div>

              <div 
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed #475569', borderRadius: '8px', padding: '24px 16px', textAlign: 'center', cursor: 'pointer', backgroundColor: '#0f172a'
                }}
              >
                <Upload size={28} color="#38bdf8" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 500 }}>
                  {selectedFile ? selectedFile.name : `Bấm để chọn file ${uploadType === 'video' ? 'Video' : 'ZIP chuỗi ảnh'}`}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  {uploadType === 'video' ? 'Hỗ trợ .mp4, .avi, .mov (tối đa 2GB)' : 'Đóng gói các ảnh .jpg, .png cùng kích thước vào 1 file .zip'}
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => { if (e.target.files?.[0]) setSelectedFile(e.target.files[0]); }}
                  accept={uploadType === 'video' ? 'video/mp4,video/avi,video/quicktime' : '.zip,application/zip'}
                  style={{ display: 'none' }}
                />
              </div>

              {uploadType === 'image_sequence' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>Tốc độ khung hình (FPS) cho chuỗi ảnh:</label>
                  <input
                    type="number" min="1" max="120" value={uploadFps}
                    onChange={(e) => setUploadFps(Number(e.target.value))}
                    style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', padding: '8px 12px', color: '#f8fafc', fontSize: '13px' }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button" onClick={() => setShowUploadModal(false)}
                  style={{ backgroundColor: '#334155', border: 'none', color: '#f8fafc', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                >
                  Hủy
                </button>
                <button
                  type="submit" disabled={isUploading || !selectedFile}
                  style={{
                    backgroundColor: '#2563eb', border: 'none', color: '#ffffff', padding: '8px 20px', borderRadius: '6px',
                    cursor: (isUploading || !selectedFile) ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px'
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
          position: 'fixed', top: '64px', right: '20px',
          backgroundColor: notification.type === 'success' ? '#065f46' : '#991b1b',
          color: '#ffffff', padding: '10px 16px', borderRadius: '8px', fontSize: '13px',
          display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 100
        }}>
          {notification.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {notification.message}
        </div>
      )}

      {/* Main Studio Area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Toolbar: Tool Modes & Classes */}
        <aside style={{
          width: '240px',
          backgroundColor: '#1e293b',
          borderRight: '1px solid #334155',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}>
          {/* Tool Modes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Công cụ thao tác
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => setToolMode('select')}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px',
                  borderRadius: '6px', border: toolMode === 'select' ? '2px solid #3b82f6' : '1px solid #334155',
                  backgroundColor: toolMode === 'select' ? '#1e3a8a' : '#0f172a', color: '#f8fafc', cursor: 'pointer', fontSize: '12px', fontWeight: 600
                }}
              >
                <MousePointer size={14} /> Chọn/Kéo
              </button>
              <button
                onClick={() => { setToolMode('draw'); setSelectedTrackId(null); }}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px',
                  borderRadius: '6px', border: toolMode === 'draw' ? '2px solid #10b981' : '1px solid #334155',
                  backgroundColor: toolMode === 'draw' ? '#064e3b' : '#0f172a', color: '#f8fafc', cursor: 'pointer', fontSize: '12px', fontWeight: 600
                }}
              >
                <PlusCircle size={14} /> Vẽ mới
              </button>
            </div>
          </div>

          {/* Motion Trail Toggle (Only in Track Mode) */}
          {annotationMode === 'track' && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: '#0f172a', padding: '8px 10px', borderRadius: '6px', border: '1px solid #334155'
            }}>
              <span style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Waypoints size={14} color="#38bdf8" /> Hiện Vệt Quỹ Đạo (T-107)
              </span>
              <button
                onClick={() => setShowMotionTrail(!showMotionTrail)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: showMotionTrail ? '#10b981' : '#64748b' }}
              >
                {showMotionTrail ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
          )}

          <div style={{ height: '1px', backgroundColor: '#334155' }} />

          {/* 6 Classes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Classes (Phím tắt 1 - 6)
            </div>
            {CLASSES.map((cls) => {
              const isActive = activeClass === cls.name;
              return (
                <button
                  key={cls.id}
                  onClick={() => {
                    setActiveClass(cls.name);
                    if (selectedTrackId !== null) {
                      handleChangeSelectedClass(cls.name);
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px',
                    borderRadius: '6px', border: isActive ? `2px solid ${cls.color}` : '1px solid #334155',
                    backgroundColor: isActive ? '#334155' : '#0f172a', color: '#f8fafc', cursor: 'pointer', fontSize: '13px'
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
              ⌨️ Phím tắt nhanh:
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px', lineHeight: 1.6 }}>
              • <b>1 - 6</b>: Đổi class đang chọn<br />
              • <b>Delete</b>: Xóa box đang chọn<br />
              • <b>Ctrl + Z / Y</b>: Undo / Redo<br />
              • <b>Space</b>: Play / Pause<br />
              • <b>← / →</b>: Chuyển frame
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
          padding: '16px',
          cursor: toolMode === 'draw' ? 'crosshair' : 'default'
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
            <Stage 
              ref={stageRef}
              width={canvasWidth} 
              height={canvasHeight}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
            >
              <Layer>
                {/* Background Frame Image */}
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

                {/* Motion Trail (T-107): draw trajectory of selected track across frames */}
                {trajectoryLinePoints.length > 2 && (
                  <>
                    <Line
                      points={trajectoryLinePoints}
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dash={[6, 4]}
                      tension={0.3}
                    />
                    {selectedTrackTrajectory.map((pt, idx) => (
                      <Circle
                        key={idx}
                        x={pt.x}
                        y={pt.y}
                        radius={pt.frame === currentFrame ? 5 : 3}
                        fill={pt.frame === currentFrame ? '#f59e0b' : '#38bdf8'}
                        stroke="#0f172a"
                        strokeWidth={1}
                      />
                    ))}
                  </>
                )}

                {/* Render Existing BBoxes */}
                {currentObjects.map((obj) => {
                  const [x, y, w, h] = obj.bbox;
                  const color = getClassColor(obj.class);
                  const isSelected = selectedTrackId === obj.track_id;

                  return (
                    <Group
                      key={obj.track_id}
                      onClick={() => {
                        if (toolMode === 'select') setSelectedTrackId(obj.track_id);
                      }}
                    >
                      <Rect
                        ref={(node) => {
                          if (node) shapeRefs.current.set(obj.track_id, node);
                          else shapeRefs.current.delete(obj.track_id);
                        }}
                        x={x * scale}
                        y={y * scale}
                        width={w * scale}
                        height={h * scale}
                        draggable={toolMode === 'select'}
                        onDragEnd={(e) => handleBoxDragEnd(obj.track_id, e)}
                        onTransformEnd={() => handleBoxTransformEnd(obj.track_id)}
                        stroke={color}
                        strokeWidth={isSelected ? 3 : 2}
                        fill={isSelected ? `${color}40` : `${color}15`}
                        cornerRadius={2}
                      />

                      {/* Header Chip: Track mode shows '#ID Class', Shape mode shows 'Class' */}
                      <Rect
                        x={x * scale}
                        y={Math.max(0, y * scale - 22)}
                        width={annotationMode === 'track' ? Math.max(110, w * scale) : Math.max(80, w * scale)}
                        height={20}
                        fill={color}
                        cornerRadius={2}
                      />
                      <KonvaText
                        x={x * scale + 6}
                        y={Math.max(2, y * scale - 18)}
                        text={annotationMode === 'track' ? `#${obj.track_id} ${obj.class}` : obj.class}
                        fontSize={11}
                        fill="#ffffff"
                        fontStyle="bold"
                      />
                    </Group>
                  );
                })}

                {/* Temporary Rectangle during Drawing */}
                {newBoxStart && newBoxCurrent && (
                  <Rect
                    x={Math.min(newBoxStart.x, newBoxCurrent.x)}
                    y={Math.min(newBoxStart.y, newBoxCurrent.y)}
                    width={Math.abs(newBoxCurrent.x - newBoxStart.x)}
                    height={Math.abs(newBoxCurrent.y - newBoxStart.y)}
                    stroke={getClassColor(activeClass)}
                    strokeWidth={2}
                    dash={[6, 4]}
                    fill={`${getClassColor(activeClass)}30`}
                  />
                )}

                {/* Transformer Handles for Resizing (T-086) */}
                <Transformer
                  ref={transformerRef}
                  rotateEnabled={false}
                  enabledAnchors={[
                    'top-left', 'top-right', 'bottom-left', 'bottom-right',
                    'top-center', 'bottom-center', 'middle-left', 'middle-right'
                  ]}
                  borderStroke="#38bdf8"
                  borderStrokeWidth={2}
                  anchorStroke="#38bdf8"
                  anchorFill="#0f172a"
                  anchorSize={8}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 10 || newBox.height < 10) return oldBox;
                    return newBox;
                  }}
                />
              </Layer>
            </Stage>
          </div>
        </main>

        {/* Right Inspector: Track Management & Object Details */}
        <aside style={{
          width: '300px',
          backgroundColor: '#1e293b',
          borderLeft: '1px solid #334155',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {/* Tab Selector: Current Frame Objects vs All Tracks in Video */}
          {annotationMode === 'track' && (
            <div style={{ display: 'flex', gap: '4px', backgroundColor: '#0f172a', padding: '3px', borderRadius: '6px' }}>
              <button
                onClick={() => setRightTab('frame')}
                style={{
                  flex: 1, padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                  fontSize: '11px', fontWeight: 600,
                  backgroundColor: rightTab === 'frame' ? '#334155' : 'transparent',
                  color: rightTab === 'frame' ? '#f8fafc' : '#94a3b8'
                }}
              >
                Frame này ({currentObjects.length})
              </button>
              <button
                onClick={() => setRightTab('tracks')}
                style={{
                  flex: 1, padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                  fontSize: '11px', fontWeight: 600,
                  backgroundColor: rightTab === 'tracks' ? '#334155' : 'transparent',
                  color: rightTab === 'tracks' ? '#f8fafc' : '#94a3b8'
                }}
              >
                Tất cả Tracks ({allTracksSummary.length})
              </button>
            </div>
          )}

          {/* Selected Object Detail Panel */}
          {selectedObject ? (
            <div style={{
              backgroundColor: '#0f172a',
              border: `2px solid ${getClassColor(selectedObject.class)}`,
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: '14px', color: getClassColor(selectedObject.class) }}>
                  {annotationMode === 'track' ? `Track #${selectedObject.track_id}` : `Shape (${selectedObject.class})`}
                </span>
                <button
                  onClick={handleDeleteSelectedBox}
                  title="Xóa BBox này"
                  style={{
                    backgroundColor: '#991b1b', border: 'none', color: '#fff',
                    padding: '4px 8px', borderRadius: '4px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600
                  }}
                >
                  <Trash2 size={12} /> Xóa box
                </button>
              </div>

              {/* Class Dropdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Class (hoặc phím 1-6):</span>
                <select
                  value={selectedObject.class}
                  onChange={(e) => handleChangeSelectedClass(e.target.value)}
                  style={{
                    backgroundColor: '#1e293b', color: '#f8fafc', border: '1px solid #475569',
                    borderRadius: '4px', padding: '6px', fontSize: '12px'
                  }}
                >
                  {CLASSES.map(c => (
                    <option key={c.id} value={c.name}>{c.display_name} [{c.hotkey}]</option>
                  ))}
                </select>
              </div>

              {/* Advanced Track Management Tools (Only in Track Mode) */}
              {annotationMode === 'track' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px', borderTop: '1px solid #334155', paddingTop: '8px' }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => {
                        setRenameTargetId(selectedObject.track_id);
                        setShowRenameModal(true);
                      }}
                      style={{
                        flex: 1, backgroundColor: '#2563eb', border: 'none', color: '#fff',
                        padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                      }}
                    >
                      <Edit3 size={12} /> Đổi ID (3 scopes)
                    </button>
                    <button
                      onClick={() => {
                        setMergeSourceId(selectedObject.track_id);
                        const otherTrack = allTracksSummary.find(t => t.track_id !== selectedObject.track_id);
                        setMergeDestId(otherTrack ? otherTrack.track_id : null);
                        setShowMergeModal(true);
                      }}
                      style={{
                        flex: 1, backgroundColor: '#7c3aed', border: 'none', color: '#fff',
                        padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                      }}
                    >
                      <GitMerge size={12} /> Gộp Track
                    </button>
                  </div>
                  <button
                    onClick={() => handleDeleteWholeTrack(selectedObject.track_id)}
                    style={{
                      backgroundColor: '#334155', border: '1px solid #ef4444', color: '#ef4444',
                      padding: '4px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 500,
                      textAlign: 'center'
                    }}
                  >
                    Xóa toàn bộ Track #{selectedObject.track_id} khỏi video
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{
              backgroundColor: '#0f172a', borderRadius: '8px', padding: '12px', textAlign: 'center', fontSize: '12px', color: '#64748b'
            }}>
              {annotationMode === 'track' ? 'Bấm vào một Track để sửa ID, gộp hoặc co giãn' : 'Bấm vào một Shape để sửa kích thước hoặc đổi class'}
            </div>
          )}

          {/* Right tab content: Frame Objects */}
          {rightTab === 'frame' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                Đối tượng tại Frame {currentFrame}
              </div>
              {currentObjects.length === 0 ? (
                <div style={{ fontSize: '13px', color: '#64748b', textAlign: 'center', marginTop: '20px' }}>
                  Không có đối tượng nào ở frame này.
                </div>
              ) : (
                currentObjects.map((obj) => {
                  const isSelected = selectedTrackId === obj.track_id;
                  const color = getClassColor(obj.class);

                  return (
                    <div
                      key={obj.track_id}
                      onClick={() => { setSelectedTrackId(obj.track_id); setToolMode('select'); }}
                      style={{
                        padding: '8px 10px', borderRadius: '6px',
                        border: isSelected ? `2px solid ${color}` : '1px solid #334155',
                        backgroundColor: isSelected ? '#334155' : '#0f172a',
                        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600, fontSize: '12px', color: color }}>
                          {annotationMode === 'track' ? `Track #${obj.track_id} · ${obj.class}` : obj.class}
                        </span>
                        <span style={{
                          fontSize: '10px', padding: '2px 5px', borderRadius: '4px',
                          backgroundColor: obj.source === 'edited' ? '#d97706' : obj.source === 'manual' ? '#059669' : '#1e293b',
                          color: ['edited', 'manual'].includes(obj.source || '') ? '#fff' : '#94a3b8'
                        }}>
                          {obj.source}
                        </span>
                      </div>
                      <div style={{ fontSize: '10px', color: '#64748b' }}>
                        x:{Math.round(obj.bbox[0])} y:{Math.round(obj.bbox[1])} w:{Math.round(obj.bbox[2])} h:{Math.round(obj.bbox[3])}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* All Tracks List Overview (T-100) */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                Danh sách Tất cả Tracks ({allTracksSummary.length})
              </div>
              {allTracksSummary.map((t) => {
                const isSelected = selectedTrackId === t.track_id;
                const color = getClassColor(t.class);
                return (
                  <div
                    key={t.track_id}
                    onClick={() => {
                      setSelectedTrackId(t.track_id);
                      // Jump to first frame of this track if current frame doesn't contain it
                      const existsInCurrent = currentObjects.some(o => o.track_id === t.track_id);
                      if (!existsInCurrent) setCurrentFrame(t.firstFrame);
                    }}
                    style={{
                      padding: '8px 10px', borderRadius: '6px',
                      border: isSelected ? `2px solid ${color}` : '1px solid #334155',
                      backgroundColor: isSelected ? '#334155' : '#0f172a',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '12px', color: color }}>
                        Track #{t.track_id} · {t.class}
                      </div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                        Frame {t.firstFrame} ➔ {t.lastFrame} ({t.frameCount} frames)
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteWholeTrack(t.track_id);
                      }}
                      title="Xóa track này"
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
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
              background: '#334155', border: 'none', color: '#f8fafc',
              padding: '8px', borderRadius: '6px', cursor: 'pointer'
            }}
          >
            <SkipBack size={16} />
          </button>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            style={{
              background: '#2563eb', border: 'none', color: '#ffffff',
              padding: '8px 12px', borderRadius: '6px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13px'
            }}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          <button
            onClick={() => setCurrentFrame(prev => Math.min((annotationData?.info.frame_count || 1) - 1, prev + 1))}
            style={{
              background: '#334155', border: 'none', color: '#f8fafc',
              padding: '8px', borderRadius: '6px', cursor: 'pointer'
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
