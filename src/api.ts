import { invoke } from "@tauri-apps/api/core";
import type { DocInfo, EnvStatus, GenerateRequest } from "./types";

export const api = {
  platformInfo: () => invoke<{ os: string; arch: string }>("platform_info"),
  checkEnv: () => invoke<EnvStatus>("check_env"),
  listVoices: () =>
    invoke<{ type: string; models: import("./types").ModelInfo[] }>("list_voices"),
  installEngine: () => invoke<void>("install_engine"),
  downloadModel: (model: string) => invoke<{ code: number }>("download_model", { model }),
  deleteModel: (model: string) => invoke<void>("delete_model", { model }),
  importDoc: (path: string) => invoke<DocInfo>("import_doc", { path }),
  previewVoice: (model: string, voice: string) =>
    invoke<string>("preview_voice", { model, voice }),
  generate: (req: GenerateRequest) => invoke<{ code: number }>("generate", { req }),
  readAudio: (path: string) => invoke<number[]>("read_audio", { path }),
  defaultOutputDir: () => invoke<string>("default_output_dir"),
};
