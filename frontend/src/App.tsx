import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Stage, Layer, Rect, Text as KonvaText, Group, Image as KonvaImage, Transformer, Line, Circle } from 'react-konva';
import { 
  Play, Pause, SkipBack, SkipForward, Download, 
  Upload, Sparkles, Save, CheckCircle2, AlertCircle, RefreshCw, X, FolderOpen, Film, Images,
  Trash2, MousePointer, PlusCircle, Undo2, Redo2, 
  GitMerge, Edit3, Eye, EyeOff, Waypoints, BoxSelect,
  Flag, CheckCheck, AlertTriangle, ShieldCheck,
  FileDown, FileUp, FileCheck, Zap
} from 'lucide-react';
import type { ClassConfig, SampleAnnotationData, BBoxObject, ReviewFlag } from './types';

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
  
  // View mode: 'track' vs 'shape'
  const [annotationMode, setAnnotationMode] = useState<'track' | 'shape'>('track');
  
  // Right sidebar tab: 'frame' | 'tracks' | 'review' (EP-09)
  const [rightTab, setRightTab] = useState<'frame' | 'tracks' | 'review'>('frame');

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

  // Manual Flag Modal (T-120)
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagNote, setFlagNote] = useState('');

  // Export Modal states (T-133, EXP-09)
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'mot' | 'coco' | 'yolo'>('json');
  const [exportVerifiedOnly, setExportVerifiedOnly] = useState(false);
  const [schemaValidationInfo, setSchemaValidationInfo] = useState<{ valid: boolean; message: string } | null>(null);

  // Import Modal states (T-132, EXP-07, DoD 12)
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  // Keyframe & Interpolation states (EP-07, T-066, T-164)
  const [keyframeStart, setKeyframeStart] = useState<{ frame: number; bbox: [number, number, number, number]; track_id: number } | null>(null);
  const [keyframeEnd, setKeyframeEnd] = useState<{ frame: number; bbox: [number, number, number, number]; track_id: number } | null>(null);

  // Autosave status (T-085.3, T-091)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const autosaveTimerRef = useRef<any>(null);

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
    setSaveStatus('unsaved');

    // Debounce Autosave after 2 seconds (T-085.3, T-091)
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(async () => {
      if (!currentSampleId) return;
      try {
        setSaveStatus('saving');
        const res = await fetch(`${API_BASE}/samples/${currentSampleId}/annotations`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newData)
        });
        if (res.ok) {
          setSaveStatus('saved');
        } else {
          setSaveStatus('unsaved');
        }
      } catch {
        setSaveStatus('unsaved');
      }
    }, 2000);
  }, [historyIndex, currentSampleId]);

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
      if (!data.flags) data.flags = [];
      setAnnotationData(data);
      setHistory([data]);
      setHistoryIndex(0);
      setCurrentFrame(0);
      setSelectedTrackId(null);
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
  const isCurrentFrameVerified = frameObj?.verified || false;

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

  // Compute all tracks summary
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

  // Motion Trail (T-107)
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

  const trajectoryLinePoints = useMemo(() => {
    const flat: number[] = [];
    selectedTrackTrajectory.forEach(p => {
      flat.push(p.x, p.y);
    });
    return flat;
  }, [selectedTrackTrajectory]);

  // Review Progress stats (T-121)
  const reviewStats = useMemo(() => {
    if (!annotationData) return { total: 0, verified: 0, percent: 0, openFlags: 0 };
    const total = annotationData.frames.length;
    const verified = annotationData.frames.filter(f => f.verified).length;
    const percent = total > 0 ? Math.round((verified / total) * 100) : 0;
    const openFlags = (annotationData.flags || []).filter(fl => !fl.resolved).length;
    return { total, verified, percent, openFlags };
  }, [annotationData]);

  // Confirm Single Frame (T-121)
  const handleToggleConfirmCurrentFrame = () => {
    if (!annotationData) return;
    const newVerified = !isCurrentFrameVerified;
    const updatedFrames = annotationData.frames.map(f => {
      if (f.frame === currentFrame) {
        return { ...f, verified: newVerified };
      }
      return f;
    });

    const allVerified = updatedFrames.every(f => f.verified);
    const newStatus = allVerified ? 'verified' : 'in_progress';

    updateDataWithHistory({
      ...annotationData,
      info: { ...annotationData.info, review_status: newStatus },
      frames: updatedFrames
    });

    showNotice('success', newVerified ? `Đã xác nhận Frame #${currentFrame}` : `Đã bỏ xác nhận Frame #${currentFrame}`);
  };

  // Confirm All Frames (T-121)
  const handleConfirmAllFrames = () => {
    if (!annotationData) return;
    const updatedFrames = annotationData.frames.map(f => ({ ...f, verified: true }));
    updateDataWithHistory({
      ...annotationData,
      info: { ...annotationData.info, review_status: 'verified' },
      frames: updatedFrames
    });
    showNotice('success', 'Đã xác nhận toàn bộ video (Verified 100%)!');
  };

  // Run Auto-Scan for Potential Issues (T-123)
  const handleAutoScanIssues = () => {
    if (!annotationData) return;
    const newFlags: ReviewFlag[] = [...(annotationData.flags || [])];
    let detectedCount = 0;

    // 1. Scan for short tracks (<= 2 frames)
    allTracksSummary.forEach(t => {
      if (t.frameCount <= 2) {
        const flagId = `flag_short_${t.track_id}`;
        if (!newFlags.some(f => f.id === flagId)) {
          newFlags.push({
            id: flagId,
            frame: t.firstFrame,
            track_id: t.track_id,
            type: 'auto',
            issue: `Track #${t.track_id} (${t.class}) xuất hiện quá ngắn (${t.frameCount} frames). Nghi ngờ False Positive.`,
            resolved: false
          });
          detectedCount++;
        }
      }
    });

    // 2. Scan for sudden jump between consecutive frames (Speed anomaly / potential ID switch)
    const trackPointsMap = new Map<number, Array<{ frame: number, cx: number, cy: number }>>();
    annotationData.frames.forEach(f => {
      f.objects.forEach(obj => {
        if (!trackPointsMap.has(obj.track_id)) trackPointsMap.set(obj.track_id, []);
        const [x, y, w, h] = obj.bbox;
        trackPointsMap.get(obj.track_id)!.push({ frame: f.frame, cx: x + w / 2, cy: y + h / 2 });
      });
    });

    trackPointsMap.forEach((points, tid) => {
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        if (p2.frame - p1.frame === 1) {
          const dist = Math.sqrt(Math.pow(p2.cx - p1.cx, 2) + Math.pow(p2.cy - p1.cy, 2));
          // If distance jumped > 180px in 1 frame
          if (dist > 180) {
            const flagId = `flag_jump_${tid}_f${p2.frame}`;
            if (!newFlags.some(f => f.id === flagId)) {
              newFlags.push({
                id: flagId,
                frame: p2.frame,
                track_id: tid,
                type: 'auto',
                issue: `Track #${tid} nhảy vị trí đột ngột (${Math.round(dist)}px). Nghi ngờ bị tráo xe (ID Switch).`,
                resolved: false
              });
              detectedCount++;
            }
          }
        }
      }
    });

    // 3. Scan for tiny boxes (w < 15 or h < 15)
    annotationData.frames.forEach(f => {
      f.objects.forEach(obj => {
        if (obj.bbox[2] < 15 || obj.bbox[3] < 15) {
          const flagId = `flag_tiny_${f.frame}_${obj.track_id}`;
          if (!newFlags.some(fl => fl.id === flagId)) {
            newFlags.push({
              id: flagId,
              frame: f.frame,
              track_id: obj.track_id,
              type: 'auto',
              issue: `BBox Track #${obj.track_id} quá nhỏ (${Math.round(obj.bbox[2])}x${Math.round(obj.bbox[3])}px).`,
              resolved: false
            });
            detectedCount++;
          }
        }
      });
    });

    updateDataWithHistory({
      ...annotationData,
      flags: newFlags
    });

    setRightTab('review');
    showNotice('success', `Đã quét tự động: phát hiện ${detectedCount} cảnh báo lỗi tiềm năng!`);
  };

  // Add Manual Review Flag (T-120)
  const handleAddManualFlag = () => {
    if (!annotationData || !flagNote.trim()) return;
    const newFlag: ReviewFlag = {
      id: `flag_manual_${Date.now()}`,
      frame: currentFrame,
      track_id: selectedTrackId || undefined,
      type: 'manual',
      issue: flagNote.trim(),
      resolved: false
    };

    updateDataWithHistory({
      ...annotationData,
      flags: [...(annotationData.flags || []), newFlag]
    });

    setFlagNote('');
    setShowFlagModal(false);
    setRightTab('review');
    showNotice('success', `Đã cắm cờ tại Frame #${currentFrame}`);
  };

  // Resolve Review Flag
  const handleToggleResolveFlag = (flagId: string) => {
    if (!annotationData) return;
    const updatedFlags = (annotationData.flags || []).map(fl => {
      if (fl.id === flagId) return { ...fl, resolved: !fl.resolved };
      return fl;
    });

    updateDataWithHistory({
      ...annotationData,
      flags: updatedFlags
    });
  };

  // Delete Review Flag
  const handleDeleteFlag = (flagId: string) => {
    if (!annotationData) return;
    const updatedFlags = (annotationData.flags || []).filter(fl => fl.id !== flagId);
    updateDataWithHistory({
      ...annotationData,
      flags: updatedFlags
    });
    showNotice('success', 'Đã xóa cờ');
  };

  // Delete selected BBox (T-088)
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

  // Delete WHOLE Track (T-104)
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
    showNotice('success', `Đã xóa toàn bộ Track #${trackIdToDelete}`);
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
    showNotice('success', `Đã đổi Track #${selectedTrackId} ➔ #${renameTargetId}`);
  };

  // Merge Tracks (T-102)
  const handleExecuteMergeTrack = () => {
    if (!annotationData || mergeSourceId === null || mergeDestId === null) return;
    if (mergeSourceId === mergeDestId) {
      showNotice('error', 'Không thể merge 1 track vào chính nó');
      return;
    }

    const updatedFrames = annotationData.frames.map((f) => {
      const hasDest = f.objects.some(obj => obj.track_id === mergeDestId);
      return {
        ...f,
        objects: f.objects.map((obj) => {
          if (obj.track_id !== mergeSourceId) return obj;
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

  // Change class (T-089)
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

  // EP-07 / T-066 / T-164: Keyframe & Linear Interpolation Handlers
  const handleSetStartKeyframe = () => {
    if (!selectedObject) return;
    setKeyframeStart({
      frame: currentFrame,
      bbox: [...selectedObject.bbox] as [number, number, number, number],
      track_id: selectedObject.track_id
    });
    showNotice('success', `Đã đặt Keyframe A (Start) tại Frame #${currentFrame} cho Track #${selectedObject.track_id}`);
  };

  const handleSetEndKeyframe = () => {
    if (!selectedObject) return;
    setKeyframeEnd({
      frame: currentFrame,
      bbox: [...selectedObject.bbox] as [number, number, number, number],
      track_id: selectedObject.track_id
    });
    showNotice('success', `Đã đặt Keyframe B (End) tại Frame #${currentFrame} cho Track #${selectedObject.track_id}`);
  };

  const handleResetKeyframes = () => {
    setKeyframeStart(null);
    setKeyframeEnd(null);
    showNotice('success', 'Đã hủy đánh dấu Keyframe');
  };

  const handleExecuteInterpolate = () => {
    if (!annotationData || !keyframeStart || !keyframeEnd) return;
    if (keyframeStart.track_id !== keyframeEnd.track_id) {
      showNotice('error', 'Hai keyframe phải thuộc cùng một Track ID!');
      return;
    }
    if (keyframeStart.frame === keyframeEnd.frame) {
      showNotice('error', 'Keyframe A và Keyframe B phải ở 2 frame khác nhau!');
      return;
    }

    const fStart = Math.min(keyframeStart.frame, keyframeEnd.frame);
    const fEnd = Math.max(keyframeStart.frame, keyframeEnd.frame);
    const boxStart = keyframeStart.frame < keyframeEnd.frame ? keyframeStart.bbox : keyframeEnd.bbox;
    const boxEnd = keyframeStart.frame < keyframeEnd.frame ? keyframeEnd.bbox : keyframeStart.bbox;
    const targetTrackId = keyframeStart.track_id;

    let trackClass = 'car';
    const foundInCur = currentObjects.find(o => o.track_id === targetTrackId);
    if (foundInCur) trackClass = foundInCur.class;

    const totalSteps = fEnd - fStart;
    const updatedFrames = annotationData.frames.map(f => {
      if (f.frame <= fStart || f.frame >= fEnd) return f;

      const t = (f.frame - fStart) / totalSteps;
      const interpBox: [number, number, number, number] = [
        Math.round(boxStart[0] + (boxEnd[0] - boxStart[0]) * t),
        Math.round(boxStart[1] + (boxEnd[1] - boxStart[1]) * t),
        Math.round(boxStart[2] + (boxEnd[2] - boxStart[2]) * t),
        Math.round(boxStart[3] + (boxEnd[3] - boxStart[3]) * t),
      ];

      const existsIdx = f.objects.findIndex(o => o.track_id === targetTrackId);
      let newObjects = [...f.objects];
      if (existsIdx >= 0) {
        newObjects[existsIdx] = {
          ...newObjects[existsIdx],
          bbox: interpBox,
          source: 'interpolated'
        };
      } else {
        newObjects.push({
          track_id: targetTrackId,
          class: trackClass,
          bbox: interpBox,
          confidence: 1.0,
          source: 'interpolated'
        });
      }

      return {
        ...f,
        objects: newObjects
      };
    });

    updateDataWithHistory({
      ...annotationData,
      frames: updatedFrames
    });

    showNotice('success', `Đã tự động nội suy Track #${targetTrackId} qua ${totalSteps - 1} frame (từ #${fStart} đến #${fEnd})!`);
  };

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

  // Drawing BBox handlers (T-087)
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

  // Transform End handler (T-086)
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

  // EP-10: Export Dataset handler (T-130, T-131, T-133)
  const handleExecuteExport = () => {
    if (!currentSampleId) return;
    let downloadUrl = '';
    let filename = '';

    if (exportFormat === 'json') {
      downloadUrl = `${API_BASE}/samples/${currentSampleId}/export/json?verified_only=${exportVerifiedOnly}&download=true`;
      filename = `${currentSampleId}_groundtruth.json`;
    } else if (exportFormat === 'mot') {
      downloadUrl = `${API_BASE}/samples/${currentSampleId}/export/mot?verified_only=${exportVerifiedOnly}`;
      filename = `${currentSampleId}_mot.txt`;
    } else if (exportFormat === 'coco') {
      downloadUrl = `${API_BASE}/samples/${currentSampleId}/export/coco?verified_only=${exportVerifiedOnly}`;
      filename = `${currentSampleId}_coco.json`;
    } else if (exportFormat === 'yolo') {
      downloadUrl = `${API_BASE}/samples/${currentSampleId}/export/yolo?verified_only=${exportVerifiedOnly}`;
      filename = `${currentSampleId}_yolo.zip`;
    }

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setShowExportModal(false);
    showNotice('success', `Đang tải xuống dữ liệu định dạng [${exportFormat.toUpperCase()}]...`);
  };

  // Schema Validation check (EXP-06)
  const handleCheckSchema = async () => {
    try {
      const res = await fetch(`${API_BASE}/samples/${currentSampleId}/validate`);
      const data = await res.json();
      setSchemaValidationInfo(data);
      if (data.valid) {
        showNotice('success', 'Kiểm tra JSON Schema: Hợp lệ 100%!');
      } else {
        showNotice('error', `Cảnh báo Schema: ${data.message}`);
      }
    } catch (e: any) {
      showNotice('error', e.message || 'Lỗi kiểm tra schema');
    }
  };

  // Import JSON round-trip handler (T-132, EXP-07, DoD 12)
  const handleExecuteImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile || !currentSampleId) {
      showNotice('error', 'Vui lòng chọn file JSON để import');
      return;
    }
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await fetch(`${API_BASE}/samples/${currentSampleId}/import/json`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Lỗi khi import file JSON');
      }
      const result = await res.json();
      showNotice('success', `Import thành công: ${result.total_frames} frames, ${result.total_boxes} boxes! (Round-trip verified)`);
      setShowImportModal(false);
      setImportFile(null);
      loadSampleData(currentSampleId);
    } catch (err: any) {
      showNotice('error', err.message || 'Lỗi khi import file');
    } finally {
      setIsImporting(false);
    }
  };

  const getClassColor = (className: string) => {
    const found = CLASSES.find(c => c.name === className);
    return found ? found.color : '#3B82F6';
  };

  const selectedObject = currentObjects.find(obj => obj.track_id === selectedTrackId);
  const currentFrameFlags = (annotationData?.flags || []).filter(fl => fl.frame === currentFrame);

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
              title="Chế độ Track: Video liên kết ID theo thời gian"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '5px',
                border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                backgroundColor: annotationMode === 'track' ? '#3b82f6' : 'transparent',
                color: annotationMode === 'track' ? '#fff' : '#94a3b8'
              }}
            >
              <Waypoints size={13} /> Chế độ Track (Video)
            </button>
            <button
              onClick={() => setAnnotationMode('shape')}
              title="Chế độ Shape: Ảnh tĩnh BBox độc lập"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '5px',
                border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
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
                backgroundColor: '#0f172a', color: '#f8fafc', border: '1px solid #334155',
                borderRadius: '6px', padding: '4px 8px', fontSize: '13px', cursor: 'pointer'
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

          {/* Review Status Badge (EP-09) */}
          {annotationData && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              backgroundColor: reviewStats.percent === 100 ? '#064e3b' : '#1e293b',
              border: reviewStats.percent === 100 ? '1px solid #10b981' : '1px solid #475569',
              padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
              color: reviewStats.percent === 100 ? '#34d399' : '#94a3b8'
            }}>
              <ShieldCheck size={13} />
              {reviewStats.percent === 100 ? 'Verified 100%' : `Tiến độ duyệt: ${reviewStats.percent}% (${reviewStats.verified}/${reviewStats.total})`}
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Undo / Redo */}
          <button
            onClick={handleUndo} disabled={historyIndex <= 0} title="Hoàn tác (Ctrl+Z)"
            style={{
              backgroundColor: '#334155', color: historyIndex <= 0 ? '#64748b' : '#f8fafc',
              border: '1px solid #475569', padding: '6px 8px', borderRadius: '6px',
              cursor: historyIndex <= 0 ? 'not-allowed' : 'pointer'
            }}
          >
            <Undo2 size={15} />
          </button>
          <button
            onClick={handleRedo} disabled={historyIndex >= history.length - 1} title="Làm lại (Ctrl+Y)"
            style={{
              backgroundColor: '#334155', color: historyIndex >= history.length - 1 ? '#64748b' : '#f8fafc',
              border: '1px solid #475569', padding: '6px 8px', borderRadius: '6px',
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
              display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#334155',
              color: '#f8fafc', border: '1px solid #475569', padding: '6px 12px',
              borderRadius: '6px', cursor: 'pointer', fontWeight: 500, fontSize: '13px'
            }}
          >
            <Upload size={14} /> Upload Video / ZIP
          </button>

          {/* Auto-Label Button */}
          <button
            onClick={handleAutoLabel} disabled={isAutoLabeling}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#7c3aed',
              color: '#ffffff', border: 'none', padding: '6px 14px', borderRadius: '6px',
              cursor: isAutoLabeling ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '13px'
            }}
          >
            <Sparkles size={14} />
            {isAutoLabeling ? 'AI Đang chạy...' : 'Auto-label (AI)'}
          </button>

          {/* Save Button with Autosave Status (T-085.3, T-091) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={handleSaveToBackend}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#059669',
                color: '#ffffff', border: 'none', padding: '6px 12px', borderRadius: '6px',
                cursor: 'pointer', fontWeight: 500, fontSize: '13px'
              }}
            >
              <Save size={14} /> Lưu
            </button>
            <div style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {saveStatus === 'saved' && (
                <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '3px' }} title="Dữ liệu đã tự động lưu qua PATCH API">
                  <CheckCircle2 size={12} /> Auto-saved
                </span>
              )}
              {saveStatus === 'saving' && (
                <span style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <RefreshCw size={12} className="animate-spin" /> Đang lưu...
                </span>
              )}
              {saveStatus === 'unsaved' && (
                <span style={{ color: '#94a3b8' }}>
                  ● Chưa lưu
                </span>
              )}
            </div>
          </div>

          {/* Import Ground Truth Button (T-132, DoD 12) */}
          <button
            onClick={() => setShowImportModal(true)}
            title="Nhập file JSON Ground Truth (Round-trip Verification)"
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#334155',
              color: '#38bdf8', border: '1px solid #0284c7', padding: '6px 12px', borderRadius: '6px',
              cursor: 'pointer', fontWeight: 600, fontSize: '13px'
            }}
          >
            <FileUp size={14} /> Import Ground Truth
          </button>

          {/* Export Dataset Button (T-133, EP-10) */}
          <button
            onClick={() => { setShowExportModal(true); setSchemaValidationInfo(null); }}
            title="Xuất dữ liệu: JSON chuẩn, MOTChallenge TXT, YOLO, COCO (T-130..133)"
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#2563eb',
              color: '#ffffff', border: 'none', padding: '6px 14px', borderRadius: '6px',
              cursor: 'pointer', fontWeight: 600, fontSize: '13px', boxShadow: '0 2px 4px rgba(37,99,235,0.3)'
            }}
          >
            <FileDown size={14} /> Export Dataset
          </button>
        </div>
      </header>

      {/* Export Dataset Modal (T-130, T-131, T-133, EXP-09) */}
      {showExportModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            width: '540px', backgroundColor: '#1e293b', borderRadius: '12px',
            border: '1px solid #475569', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ backgroundColor: '#2563eb', padding: '6px', borderRadius: '8px', color: '#fff' }}>
                  <FileDown size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                    Xuất Dữ Liệu Ground Truth (Export)
                  </h3>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Sample: {currentSampleId}</div>
                </div>
              </div>
              <button onClick={() => setShowExportModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {/* Quality Warning Banner (EXP-09) */}
            {reviewStats.total > 0 && (reviewStats.total - reviewStats.verified > 0 || (annotationData?.flags?.length || 0) > 0) && (
              <div style={{
                backgroundColor: '#451a03', border: '1px solid #d97706', borderRadius: '8px',
                padding: '12px', display: 'flex', gap: '10px', alignItems: 'flex-start'
              }}>
                <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '12px', color: '#fef3c7', lineHeight: '1.4' }}>
                  <strong>Cảnh báo chất lượng dữ liệu (EXP-09):</strong>
                  <div>
                    Còn <strong style={{ color: '#fbbf24' }}>{reviewStats.total - reviewStats.verified}</strong> frame chưa duyệt 
                    ({100 - reviewStats.percent}%) và <strong style={{ color: '#f87171' }}>{annotationData?.flags?.length || 0}</strong> cờ lỗi chưa xử lý.
                  </div>
                  <div style={{ fontSize: '11px', color: '#fcd34d', marginTop: '3px' }}>
                    Bạn có thể tiếp tục xuất toàn bộ hoặc tick chọn chỉ xuất các frame đã duyệt bên dưới.
                  </div>
                </div>
              </div>
            )}

            {/* Format Selection Grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#cbd5e1' }}>Chọn định dạng xuất:</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {/* Option 1: Standard JSON */}
                <div 
                  onClick={() => setExportFormat('json')}
                  style={{
                    border: exportFormat === 'json' ? '2px solid #3b82f6' : '1px solid #334155',
                    backgroundColor: exportFormat === 'json' ? '#1e3a8a' : '#0f172a',
                    padding: '12px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#38bdf8' }}>●</span> JSON Chuẩn (Đề bài)
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    Frame-based [x,y,w,h] pixel gốc, chuẩn schema BBox 2D Tracking (T-130)
                  </div>
                </div>

                {/* Option 2: MOTChallenge */}
                <div 
                  onClick={() => setExportFormat('mot')}
                  style={{
                    border: exportFormat === 'mot' ? '2px solid #3b82f6' : '1px solid #334155',
                    backgroundColor: exportFormat === 'mot' ? '#1e3a8a' : '#0f172a',
                    padding: '12px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#10b981' }}>●</span> MOTChallenge (.txt)
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    Format MOT chuẩn cho TrackEval benchmark, frame 1-based (T-131)
                  </div>
                </div>

                {/* Option 3: YOLO */}
                <div 
                  onClick={() => setExportFormat('yolo')}
                  style={{
                    border: exportFormat === 'yolo' ? '2px solid #3b82f6' : '1px solid #334155',
                    backgroundColor: exportFormat === 'yolo' ? '#1e3a8a' : '#0f172a',
                    padding: '12px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#f59e0b' }}>●</span> YOLO Format (.zip)
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    Labels frame_*.txt chuẩn normalized bbox xywh + track_id + data.yaml
                  </div>
                </div>

                {/* Option 4: COCO */}
                <div 
                  onClick={() => setExportFormat('coco')}
                  style={{
                    border: exportFormat === 'coco' ? '2px solid #3b82f6' : '1px solid #334155',
                    backgroundColor: exportFormat === 'coco' ? '#1e3a8a' : '#0f172a',
                    padding: '12px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#8b5cf6' }}>●</span> COCO Format (.json)
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    Chuẩn COCO dataset (images, annotations, categories) cho PyTorch/MMDet
                  </div>
                </div>
              </div>
            </div>

            {/* Scope Toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              backgroundColor: '#0f172a', padding: '10px 12px', borderRadius: '8px', border: '1px solid #334155'
            }}>
              <input
                type="checkbox" id="verifiedOnlyCheck"
                checked={exportVerifiedOnly}
                onChange={(e) => setExportVerifiedOnly(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: '#3b82f6', width: '16px', height: '16px' }}
              />
              <label htmlFor="verifiedOnlyCheck" style={{ fontSize: '12px', color: '#f8fafc', cursor: 'pointer', fontWeight: 500 }}>
                Chỉ xuất các frame đã duyệt (Verified frames only) — Bỏ qua các frame chưa kiểm tra
              </label>
            </div>

            {/* Schema Validation Check Status */}
            {schemaValidationInfo && (
              <div style={{
                fontSize: '12px', padding: '8px 12px', borderRadius: '6px',
                backgroundColor: schemaValidationInfo.valid ? '#064e3b' : '#7f1d1d',
                color: schemaValidationInfo.valid ? '#a7f3d0' : '#fecaca',
                border: schemaValidationInfo.valid ? '1px solid #059669' : '1px solid #dc2626'
              }}>
                {schemaValidationInfo.valid ? '✓ JSON Schema: Hợp lệ 100%' : `✗ Lỗi Schema: ${schemaValidationInfo.message}`}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
              <button
                type="button" onClick={handleCheckSchema}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#334155',
                  border: '1px solid #475569', color: '#cbd5e1', padding: '8px 12px', borderRadius: '6px',
                  cursor: 'pointer', fontSize: '12px', fontWeight: 500
                }}
              >
                <FileCheck size={14} color="#38bdf8" /> Kiểm tra Schema (EXP-06)
              </button>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button" onClick={() => setShowExportModal(false)}
                  style={{ backgroundColor: '#334155', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                >
                  Hủy
                </button>
                <button
                  type="button" onClick={handleExecuteExport}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#2563eb',
                    border: 'none', color: '#fff', padding: '8px 18px', borderRadius: '6px',
                    cursor: 'pointer', fontWeight: 600, fontSize: '13px'
                  }}
                >
                  <Download size={14} /> Tải Xuống File
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Ground Truth Modal (T-132, EXP-07, DoD 12) */}
      {showImportModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            width: '480px', backgroundColor: '#1e293b', borderRadius: '12px',
            border: '1px solid #475569', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ backgroundColor: '#0284c7', padding: '6px', borderRadius: '8px', color: '#fff' }}>
                  <FileUp size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                    Nhập Ground Truth (Round-Trip Test)
                  </h3>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Khôi phục và kiểm chứng tính toàn vẹn (DoD 12)</div>
                </div>
              </div>
              <button onClick={() => setShowImportModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleExecuteImport} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: '1.4' }}>
                Chọn file JSON ground truth (được xuất từ công cụ này hoặc có cấu trúc tương thích) để nạp vào sample <strong>{currentSampleId}</strong>.
              </div>

              {/* File selector dropzone */}
              <div
                onClick={() => importFileInputRef.current?.click()}
                style={{
                  border: '2px dashed #0284c7', borderRadius: '8px', padding: '24px 16px',
                  textAlign: 'center', cursor: 'pointer', backgroundColor: '#0f172a'
                }}
              >
                <FileUp size={28} color="#38bdf8" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 500 }}>
                  {importFile ? importFile.name : 'Bấm để chọn file Ground Truth JSON (.json)'}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Hỗ trợ JSON format chuẩn (BBox2DTracking schema)
                </div>
                <input
                  type="file" ref={importFileInputRef}
                  onChange={(e) => { if (e.target.files?.[0]) setImportFile(e.target.files[0]); }}
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                />
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button" onClick={() => setShowImportModal(false)}
                  style={{ backgroundColor: '#334155', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                >
                  Hủy
                </button>
                <button
                  type="submit" disabled={isImporting || !importFile}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#0284c7',
                    border: 'none', color: '#fff', padding: '8px 18px', borderRadius: '6px',
                    cursor: (isImporting || !importFile) ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '13px'
                  }}
                >
                  {isImporting && <RefreshCw size={14} className="animate-spin" />}
                  {isImporting ? 'Đang nạp...' : 'Xác nhận Import'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Flag Note Modal (T-120) */}
      {showFlagModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            width: '400px', backgroundColor: '#1e293b', borderRadius: '12px',
            border: '1px solid #475569', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: '15px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Flag size={16} color="#f59e0b" /> Cắm cờ Frame #{currentFrame}
              </span>
              <button onClick={() => setShowFlagModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Ghi chú lỗi cần xem lại:</label>
              <textarea
                rows={3}
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
                placeholder="VD: Xe bị cột đèn che khuất, cần vẽ lại BBox..."
                style={{
                  backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px',
                  padding: '8px 12px', color: '#f8fafc', fontSize: '13px', resize: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setShowFlagModal(false)}
                style={{ backgroundColor: '#334155', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer' }}
              >
                Hủy
              </button>
              <button
                onClick={handleAddManualFlag}
                style={{ backgroundColor: '#f59e0b', border: 'none', color: '#000', padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
              >
                Lưu cờ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Track Modal (T-101) */}
      {showRenameModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            width: '420px', backgroundColor: '#1e293b', borderRadius: '12px',
            border: '1px solid #475569', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
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
                type="number" min="1" value={renameTargetId}
                onChange={(e) => setRenameTargetId(Number(e.target.value))}
                style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', padding: '8px 12px', color: '#f8fafc', fontSize: '14px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>Phạm vi áp dụng:</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#f8fafc', cursor: 'pointer' }}>
                <input type="radio" name="scope" checked={renameScope === 'onwards'} onChange={() => setRenameScope('onwards')} />
                <b>Từ frame này trở về sau ({currentFrame} ➔ hết)</b> - Sửa ID switch
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#cbd5e1', cursor: 'pointer' }}>
                <input type="radio" name="scope" checked={renameScope === 'current'} onChange={() => setRenameScope('current')} />
                Chỉ ở frame hiện tại ({currentFrame})
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#cbd5e1', cursor: 'pointer' }}>
                <input type="radio" name="scope" checked={renameScope === 'all'} onChange={() => setRenameScope('all')} />
                Toàn bộ video (Tất cả frame của track #{selectedTrackId})
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button onClick={() => setShowRenameModal(false)} style={{ backgroundColor: '#334155', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer' }}>
                Hủy
              </button>
              <button onClick={handleExecuteRenameTrack} style={{ backgroundColor: '#2563eb', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                Xác nhận đổi ID
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Track Modal (T-102) */}
      {showMergeModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            width: '440px', backgroundColor: '#1e293b', borderRadius: '12px',
            border: '1px solid #475569', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
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
                value={mergeSourceId || ''} onChange={(e) => setMergeSourceId(Number(e.target.value))}
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
                value={mergeDestId || ''} onChange={(e) => setMergeDestId(Number(e.target.value))}
                style={{ backgroundColor: '#0f172a', color: '#fff', border: '1px solid #475569', padding: '8px', borderRadius: '6px' }}
              >
                {allTracksSummary.filter(t => t.track_id !== mergeSourceId).map(t => (
                  <option key={t.track_id} value={t.track_id}>Track #{t.track_id} ({t.class} - {t.frameCount} frames)</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button onClick={() => setShowMergeModal(false)} style={{ backgroundColor: '#334155', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer' }}>
                Hủy
              </button>
              <button onClick={handleExecuteMergeTrack} style={{ backgroundColor: '#7c3aed', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                Gộp 2 Track
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Dialog Modal (T-017) */}
      {showUploadModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            width: '500px', backgroundColor: '#1e293b', borderRadius: '12px',
            border: '1px solid #475569', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', overflow: 'hidden'
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
                  type="button" onClick={() => { setUploadType('video'); setSelectedFile(null); }}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px',
                    borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    backgroundColor: uploadType === 'video' ? '#2563eb' : 'transparent', color: uploadType === 'video' ? '#fff' : '#94a3b8'
                  }}
                >
                  <Film size={15} /> Video (.mp4, .avi, .mov)
                </button>
                <button
                  type="button" onClick={() => { setUploadType('image_sequence'); setSelectedFile(null); }}
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
                  type="file" ref={fileInputRef}
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

          {/* Review Actions (EP-09) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: '#0f172a', padding: '10px', borderRadius: '8px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ShieldCheck size={13} /> Quy trình Review (EP-09)
            </div>
            
            <button
              onClick={handleToggleConfirmCurrentFrame}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                padding: '6px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                backgroundColor: isCurrentFrameVerified ? '#059669' : '#334155', color: '#fff'
              }}
            >
              <CheckCheck size={14} /> {isCurrentFrameVerified ? 'Đã duyệt Frame này' : 'Duyệt Frame này (T-121)'}
            </button>

            <button
              onClick={() => setShowFlagModal(true)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                padding: '6px', borderRadius: '5px', border: '1px solid #f59e0b', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                backgroundColor: 'transparent', color: '#f59e0b'
              }}
            >
              <Flag size={14} /> Cắm cờ Frame (T-120)
            </button>

            <button
              onClick={handleAutoScanIssues}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                padding: '6px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                backgroundColor: '#b45309', color: '#fff'
              }}
            >
              <AlertTriangle size={14} /> Quét lỗi tự động (T-123)
            </button>
          </div>

          {/* Motion Trail Toggle (Only in Track Mode) */}
          {annotationMode === 'track' && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: '#0f172a', padding: '8px 10px', borderRadius: '6px', border: '1px solid #334155'
            }}>
              <span style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Waypoints size={14} color="#38bdf8" /> Hiện Vệt Quỹ Đạo
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
          cursor: toolMode === 'draw' ? 'crosshair' : 'default',
          position: 'relative'
        }}>
          {/* Frame Flag Indicator Overlay */}
          {currentFrameFlags.length > 0 && (
            <div style={{
              position: 'absolute', top: '24px', left: '24px', zIndex: 5,
              backgroundColor: 'rgba(245, 158, 11, 0.9)', color: '#000',
              padding: '6px 12px', borderRadius: '6px', fontWeight: 600, fontSize: '12px',
              display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
            }}>
              <Flag size={14} /> Có {currentFrameFlags.length} cờ cảnh báo tại frame này!
            </div>
          )}

          <div style={{
            border: isCurrentFrameVerified ? '2px solid #10b981' : '2px solid #334155',
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

                {/* Motion Trail (T-107) */}
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
                        perfectDrawEnabled={false}
                      />

                      <Rect
                        x={x * scale}
                        y={Math.max(0, y * scale - 22)}
                        width={annotationMode === 'track' ? Math.max(110, w * scale) : Math.max(80, w * scale)}
                        height={20}
                        fill={color}
                        cornerRadius={2}
                        perfectDrawEnabled={false}
                        listening={false}
                      />
                      <KonvaText
                        x={x * scale + 6}
                        y={Math.max(2, y * scale - 18)}
                        text={annotationMode === 'track' ? `#${obj.track_id} ${obj.class}${obj.source === 'interpolated' ? ' ~' : ''}` : obj.class}
                        fontSize={11}
                        fontStyle="bold"
                        fill="#ffffff"
                        perfectDrawEnabled={false}
                        listening={false}
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

        {/* Right Inspector: 3 Tabs (Frame Objects, All Tracks, Review & Flags) */}
        <aside style={{
          width: '320px',
          backgroundColor: '#1e293b',
          borderLeft: '1px solid #334155',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {/* Tab Selector */}
          <div style={{ display: 'flex', gap: '3px', backgroundColor: '#0f172a', padding: '3px', borderRadius: '6px' }}>
            <button
              onClick={() => setRightTab('frame')}
              style={{
                flex: 1, padding: '6px 4px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                fontSize: '11px', fontWeight: 600,
                backgroundColor: rightTab === 'frame' ? '#334155' : 'transparent',
                color: rightTab === 'frame' ? '#f8fafc' : '#94a3b8'
              }}
            >
              Frame ({currentObjects.length})
            </button>
            <button
              onClick={() => setRightTab('tracks')}
              style={{
                flex: 1, padding: '6px 4px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                fontSize: '11px', fontWeight: 600,
                backgroundColor: rightTab === 'tracks' ? '#334155' : 'transparent',
                color: rightTab === 'tracks' ? '#f8fafc' : '#94a3b8'
              }}
            >
              Tracks ({allTracksSummary.length})
            </button>
            <button
              onClick={() => setRightTab('review')}
              style={{
                flex: 1, padding: '6px 4px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                fontSize: '11px', fontWeight: 600,
                backgroundColor: rightTab === 'review' ? '#334155' : 'transparent',
                color: rightTab === 'review' ? (reviewStats.openFlags > 0 ? '#f59e0b' : '#34d399') : '#94a3b8',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px'
              }}
            >
              <Flag size={11} /> Cờ lỗi ({reviewStats.openFlags})
            </button>
          </div>

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

              {/* Track Management Tools */}
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

                  {/* Keyframe & Interpolation Tools (EP-07, T-066, T-164) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid #334155', paddingTop: '8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Zap size={12} /> Keyframe & Nội suy (T-066)
                    </div>
                    
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={handleSetStartKeyframe}
                        title="Đặt BBox tại frame này làm mốc bắt đầu"
                        style={{
                          flex: 1, padding: '5px', borderRadius: '4px', border: '1px solid #0284c7',
                          backgroundColor: keyframeStart?.track_id === selectedObject.track_id && keyframeStart?.frame === currentFrame ? '#0369a1' : '#0f172a',
                          color: '#38bdf8', cursor: 'pointer', fontSize: '11px', fontWeight: 600
                        }}
                      >
                        {keyframeStart && keyframeStart.track_id === selectedObject.track_id 
                          ? `Mốc A: #${keyframeStart.frame}` 
                          : 'Đặt Mốc A'}
                      </button>

                      <button
                        onClick={handleSetEndKeyframe}
                        title="Đặt BBox tại frame này làm mốc kết thúc"
                        style={{
                          flex: 1, padding: '5px', borderRadius: '4px', border: '1px solid #10b981',
                          backgroundColor: keyframeEnd?.track_id === selectedObject.track_id && keyframeEnd?.frame === currentFrame ? '#047857' : '#0f172a',
                          color: '#34d399', cursor: 'pointer', fontSize: '11px', fontWeight: 600
                        }}
                      >
                        {keyframeEnd && keyframeEnd.track_id === selectedObject.track_id 
                          ? `Mốc B: #${keyframeEnd.frame}` 
                          : 'Đặt Mốc B'}
                      </button>
                    </div>

                    {/* Execute Interpolate Button */}
                    {keyframeStart && keyframeEnd && keyframeStart.track_id === selectedObject.track_id && keyframeEnd.track_id === selectedObject.track_id && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <button
                          onClick={handleExecuteInterpolate}
                          style={{
                            backgroundColor: '#0284c7', border: 'none', color: '#fff',
                            padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                          }}
                        >
                          <Sparkles size={13} /> Nội suy từ #{Math.min(keyframeStart.frame, keyframeEnd.frame)} → #{Math.max(keyframeStart.frame, keyframeEnd.frame)}
                        </button>
                        <button
                          onClick={handleResetKeyframes}
                          style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '10px', cursor: 'pointer', textAlign: 'center' }}
                        >
                          Hủy đánh dấu Keyframe
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Tab 1: Current Frame Objects */}
          {rightTab === 'frame' && (
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
          )}

          {/* Tab 2: All Tracks List (T-100) */}
          {rightTab === 'tracks' && (
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

          {/* Tab 3: Review & Problematic Frames List (T-122) */}
          {rightTab === 'review' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' }}>
                  Cờ cảnh báo & Review
                </span>
                <button
                  onClick={handleConfirmAllFrames}
                  style={{
                    backgroundColor: '#059669', color: '#fff', border: 'none', padding: '3px 8px',
                    borderRadius: '4px', fontSize: '10px', cursor: 'pointer', fontWeight: 600
                  }}
                >
                  Confirm All
                </button>
              </div>

              {(annotationData?.flags || []).length === 0 ? (
                <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'center', marginTop: '20px' }}>
                  Chưa có cờ cảnh báo nào.<br />
                  <button
                    onClick={handleAutoScanIssues}
                    style={{
                      marginTop: '8px', backgroundColor: '#334155', color: '#38bdf8', border: '1px solid #475569',
                      padding: '4px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer'
                    }}
                  >
                    Bấm để quét lỗi tự động
                  </button>
                </div>
              ) : (
                (annotationData?.flags || []).map((fl) => (
                  <div
                    key={fl.id}
                    onClick={() => {
                      setCurrentFrame(fl.frame);
                      if (fl.track_id) setSelectedTrackId(fl.track_id);
                    }}
                    style={{
                      padding: '8px 10px', borderRadius: '6px',
                      border: fl.resolved ? '1px solid #334155' : '1px solid #f59e0b',
                      backgroundColor: fl.resolved ? '#0f172a' : '#1e1b18',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{
                        fontWeight: 600, fontSize: '11px',
                        color: fl.resolved ? '#94a3b8' : '#f59e0b',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }}>
                        <Flag size={12} /> Frame #{fl.frame} {fl.track_id ? `(Track #${fl.track_id})` : ''}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleResolveFlag(fl.id);
                          }}
                          style={{
                            fontSize: '10px', padding: '2px 6px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                            backgroundColor: fl.resolved ? '#334155' : '#059669', color: '#fff'
                          }}
                        >
                          {fl.resolved ? 'Mở lại' : 'Đã sửa'}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFlag(fl.id);
                          }}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: '11px', color: fl.resolved ? '#64748b' : '#cbd5e1', lineHeight: 1.4 }}>
                      {fl.issue}
                    </div>
                  </div>
                ))
              )}
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

        {/* Frame Display with Verified Check */}
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', minWidth: '150px', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
          {isCurrentFrameVerified && (
            <span title="Frame đã được duyệt" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <CheckCircle2 size={16} color="#10b981" />
            </span>
          )}
          Frame: <span style={{ color: '#38bdf8' }}>{currentFrame}</span> / {(annotationData?.info.frame_count || 1) - 1}
        </div>
      </footer>
    </div>
  );
}
