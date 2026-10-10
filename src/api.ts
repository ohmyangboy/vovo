import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Bundle,
  Caption,
  CloneStatus,
  DocInfo,
  EnvStatus,
  ExportFormat,
  GenerateRequest,
  ModelInfo,
  PreparedReference,
  ReferenceTranscription,
  SavedVoice,
  WorkspaceRequest,
} from "./types";

export const desktop = isTauri();
export const mediaURL = (path: string) =>
  desktop ? convertFileSrc(path) : path;
function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!desktop)
    return Promise.reject(
      new Error("当前是网页界面预览，请在桌面应用中生成语音"),
    );
  return invoke<T>(command, args);
}
export const api = {
  platformInfo: () => call<{ os: string; arch: string }>("platform_info"),
  checkEnv: () => call<EnvStatus>("check_env"),
  listVoices: () => call<{ models: ModelInfo[] }>("list_voices"),
  cloneStatus: () => call<CloneStatus>("clone_status"),
  prepareStudio: (jobId: string) => call<void>("prepare_studio", { jobId }),
  installEngine: (jobId?: string) => call<void>("install_engine", { jobId }),
  downloadModel: (model: string, jobId?: string) =>
    call<{ code: number }>("download_model", { model, jobId }),
  deleteModel: (model: string) => call<void>("delete_model", { model }),
  setupClone: (jobId: string) => call<void>("setup_clone", { jobId }),
  downloadClone: (jobId: string) => call<void>("download_clone", { jobId }),
  deleteClone: () => call<void>("delete_clone"),
  importDoc: (path: string) => call<DocInfo>("import_doc", { path }),
  defaultOutputDir: () => call<string>("default_output_dir"),
  listLibrary: () => call<SavedVoice[]>("list_library"),
  prepareReference: (
    jobId: string,
    req: { path: string; start: number; duration: number; authorized: boolean },
  ) => call<PreparedReference>("prepare_reference", { jobId, req }),
  transcribeReference: (jobId: string, id: string) =>
    call<ReferenceTranscription>("transcribe_reference", { jobId, id }),
  discardReference: (id: string) => call<void>("discard_reference", { id }),
  saveVoice: (req: {
    referenceId: string;
    name: string;
    refText: string;
    previewId?: string;
    authorized: boolean;
  }) => call<SavedVoice>("save_voice", { req }),
  addVoiceReference: (id: string, referenceId: string, refText: string, authorized: boolean) =>
    call<SavedVoice>("add_voice_reference", { id, referenceId, refText, authorized }),
  deleteVoice: (id: string) => call<void>("delete_voice", { id }),
  renameVoice: (id: string, name: string) =>
    call<SavedVoice>("rename_voice", { id, name }),
  generateWorkspace: (jobId: string, req: WorkspaceRequest) =>
    call<Bundle>("generate_workspace", { jobId, req }),
  cancelJob: (jobId: string) => call<void>("cancel_job", { jobId }),
  listHistory: () => call<Bundle[]>("list_history"),
  listPreviews: () => call<Bundle[]>("list_previews"),
  clearPreviews: () => call<void>("clear_previews"),
  saveCaptions: (id: string, captions: Caption[]) =>
    call<Bundle>("save_captions", { id, captions }),
  exportBundle: (id: string, directory: string, formats: ExportFormat[]) =>
    call<string>("export_bundle", { id, directory, formats }),
  deleteRecord: (id: string) => call<void>("delete_record", { id }),
  previewVoice: (model: string, voice: string) =>
    call<string>("preview_voice", { model, voice }),
  generate: (req: GenerateRequest) =>
    call<{ code: number }>("generate", { req }),
  readAudio: (path: string) => call<number[]>("read_audio", { path }),
};
