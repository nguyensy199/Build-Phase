export interface ClassConfig {
  id: number;
  name: string;
  display_name: string;
  color: string;
  hotkey: string;
  coco_id: number | null;
  coco_note?: string;
}

export interface BBoxObject {
  track_id: number;
  class: string;
  bbox: [number, number, number, number]; // [x, y, width, height]
  confidence?: number;
  source?: "auto" | "manual" | "edited" | "interpolated";
}

export interface FrameAnnotation {
  frame: number;
  objects: BBoxObject[];
}

export interface SampleInfo {
  sample_id: string;
  name?: string;
  type: "video" | "image_sequence";
  fps: number;
  width: number;
  height: number;
  frame_count: number;
  bbox_format: string;
  frame_index_base: number;
  exported_at?: string;
  model_version?: string;
  tracker?: string;
}

export interface SampleAnnotationData {
  info: SampleInfo;
  classes: string[];
  frames: FrameAnnotation[];
}
