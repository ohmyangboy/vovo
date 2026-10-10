import { desktop } from "../api";
import type { Page } from "../types";
import { Icon } from "./Icon";

export function AppTitlebar({ page, onSettings }: { page: Page; onSettings: () => void }) {
  return (
    <header className={`app-titlebar${desktop ? " native-titlebar" : ""}`} data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <span className="brand-mark" data-tauri-drag-region>
          <img src="/vovo-logo.png" alt="" width={28} height={28} draggable={false} data-tauri-drag-region />
        </span>
        <strong data-tauri-drag-region>vovo</strong>
      </div>
      <span className="titlebar-divider" data-tauri-drag-region />
      <h1 data-tauri-drag-region>{page === "settings" ? "设置" : page === "history" ? "生成记录" : "生成工作台"}</h1>
      <span className="titlebar-spacer" data-tauri-drag-region />
      <span className="titlebar-privacy" title={desktop ? "文稿与声音在本机处理，内容不上传" : "网页仅供界面预览"}>
        <Icon name="shield" size={14} /><span>{desktop ? "本地处理" : "网页预览"}</span>
      </span>
      <button className={`icon-button titlebar-settings${page === "settings" ? " active" : ""}`}
        aria-label="设置" aria-pressed={page === "settings"} title="设置" onClick={onSettings}>
        <Icon name="settings" size={18} />
      </button>
    </header>
  );
}
