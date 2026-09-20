export interface VoiceInfo {
  id: string;
  group: string;
  label: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  desc: string;
  installed: boolean;
  sizeMB: number;
  voices: VoiceInfo[];
}

export interface EnvStatus {
  installed: boolean;
  ready: boolean;
  info?: {
    python?: string;
    packages?: Record<string, string | null>;
    models?: Record<string, { installed: boolean; sizeMB: number; name: string }>;
    ready?: boolean;
  };
  raw?: string;
}

export interface DocInfo {
  type: string;
  title: string;
  paragraphs: string[];
  count: number;
}

export interface GenerateRequest {
  model: string;
  voice: string;
  speed: number;
  paragraphs: string[];
  outdir: string;
  name: string;
}

export interface EngineEvent {
  type: string;
  message?: string;
  done?: number;
  total?: number;
  label?: string;
  mp3?: string;
  srt?: string;
  duration?: number;
  sentences?: number;
}
