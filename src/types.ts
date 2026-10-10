export interface VoiceInfo {
  id: string;
  group: string;
  label: string;
  ready?: boolean;
  previewAudio?: string;
  previewDuration?: number;
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
    models?: Record<
      string,
      { installed: boolean; sizeMB: number; name: string }
    >;
    ready?: boolean;
  };
  raw?: string;
}
export interface CloneStatus {
  supported: boolean;
  engine: string | null;
  installed: boolean;
  ffmpeg: boolean;
  transcriptionInstalled: boolean;
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
  voiceKey?: string;
  previewAudio?: string;
  previewDuration?: number;
}

export type Page = "workspace" | "history" | "settings";
export interface PreviewPlayback {
  path: string;
  name: string;
  duration?: number;
  startedAt: number;
  origin: "workspace" | "voice";
  voiceKey: string;
}
export type ModelId = "zh" | "en" | "clone";
export type ExportFormat = "mp3" | "wav" | "srt" | "txt";
export interface Draft {
  title: string;
  text: string;
  voiceKey: string;
  speed: number;
}
export interface Preferences {
  theme: "system" | "light" | "dark";
  outputDir: string;
  autoExport: boolean;
  formats: ExportFormat[];
  favorites: string[];
  recent: string[];
}
export interface SavedVoice {
  id: string;
  name: string;
  model: "clone";
  language: string;
  reference: string;
  refText: string;
  duration: number;
  createdAt: number;
  authorizedAt: number;
  previewAudio: string | null;
  references?: { reference: string; refText: string; duration: number }[];
}
export interface VoiceChoice {
  key: string;
  id: string;
  model: ModelId;
  name: string;
  kind: "preset" | "cloned";
  language: "zh" | "en" | "auto";
  group: string;
  description: string;
  ready: boolean;
  previewAudio?: string;
  previewDuration?: number;
}
export interface PreparedReference {
  id: string;
  path: string;
  duration: number;
  peaks: number[];
  warnings: string[];
  authorizedAt: number;
}
export interface ReferenceTranscription {
  referenceId: string;
  text: string;
}
export interface Caption {
  start: number;
  end: number;
  text: string;
}
export interface Bundle {
  schemaVersion?: number;
  modelRevision?: string | null;
  id: string;
  title: string;
  text: string;
  model: ModelId;
  voice: string;
  voiceName: string;
  speed: number;
  createdAt: number;
  duration: number;
  sampleRate: number;
  mp3: string;
  wav: string;
  srt: string;
  txt: string;
  captions: Caption[];
  captionRevision: number;
  preview: boolean;
}
export interface WorkspaceRequest {
  model: ModelId;
  voice: string;
  voiceName: string;
  title: string;
  text: string;
  speed: number;
  preview: boolean;
  reference?: { id: string; refText: string };
}
export interface JobEvent extends EngineEvent {
  jobId: string;
  sequence: number;
  stage?: string;
}
export interface ActiveJob {
  id: string;
  kind: string;
  label: string;
  stage: string;
  done: number;
  total: number;
  cancelling: boolean;
  voiceKey?: string;
}
