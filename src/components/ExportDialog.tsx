import { useState } from "react";
import type { Bundle, ExportFormat, Preferences } from "../types";
import { Modal } from "./Modal";
import { Icon } from "./Icon";

const descriptions = {
  mp3: "方便分享与视频配音",
  wav: "模型原生采样率的无损音频",
  srt: "句级字幕，可导入剪辑工具",
  txt: "本次生成使用的文稿",
};
export function ExportDialog({
  bundle,
  preferences,
  busy,
  onClose,
  onDirectory,
  onExport,
}: {
  bundle: Bundle;
  preferences: Preferences;
  busy: boolean;
  onClose: () => void;
  onDirectory: () => Promise<string | undefined>;
  onExport: (directory: string, formats: ExportFormat[]) => Promise<void>;
}) {
  const [directory, setDirectory] = useState(preferences.outputDir);
  const [formats, setFormats] = useState(preferences.formats);
  const [picking, setPicking] = useState(false);
  async function choose() {
    setPicking(true);
    try {
      const path = await onDirectory();
      if (path) setDirectory(path);
    } finally {
      setPicking(false);
    }
  }
  return (
    <Modal
      title="导出配音与字幕"
      description={bundle.title}
      onClose={onClose}
      busy={busy || picking}
    >
      <div className="export-body">
        <div className="export-formats">
          {(["mp3", "wav", "srt", "txt"] as const).map((format) => (
            <label
              key={format}
              className={formats.includes(format) ? "checked" : ""}
            >
              <input
                type="checkbox"
                disabled={busy}
                checked={formats.includes(format)}
                onChange={() =>
                  setFormats((previous) =>
                    previous.includes(format)
                      ? previous.filter((f) => f !== format)
                      : [...previous, format],
                  )
                }
              />
              <span>
                <strong>{format.toUpperCase()}</strong>
                <small>{descriptions[format]}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="export-directory">
          <span className="section-label">保存到</span>
          <button
            className="directory-button"
            disabled={busy || picking}
            onClick={() => void choose()}
          >
            <Icon name="folder" size={18} />
            <span title={directory}>{directory || "选择导出文件夹"}</span>
            <Icon name="chevron" size={15} />
          </button>
        </div>
        <p className="help-text">
          会新建一个带版本编号的文件夹，不覆盖已有文件。更换格式与再次导出不会重新生成语音。
        </p>
      </div>
      <footer className="modal-footer">
        <button
          className="button ghost"
          disabled={busy || picking}
          onClick={onClose}
        >
          取消
        </button>
        <span className="spacer" />
        <button
          className="button primary"
          disabled={busy || picking || !directory || !formats.length}
          onClick={() => void onExport(directory, formats)}
        >
          {busy ? (
            <span className="spinner" />
          ) : (
            <Icon name="download" size={16} />
          )}
          导出 {formats.length} 种文件
        </button>
      </footer>
    </Modal>
  );
}
