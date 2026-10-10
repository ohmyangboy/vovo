import type { ActiveJob } from "../types";

export function JobProgress({
  job,
  onCancel,
}: {
  job: ActiveJob;
  onCancel: () => void;
}) {
  const quantified = job.total > 0;
  const percent = quantified ? Math.min(100, (job.done / job.total) * 100) : 0;
  const label = job.cancelling ? "正在取消，请稍候…" : job.label;
  return (
    <div className="job-progress" role="status" aria-live="polite">
      <div className="job-caption">
        <span className="spinner" />
        <strong>{label}</strong>
        {quantified && (
          <span>
            {job.stage === "samples"
              ? `${job.done} / ${job.total} 个声音`
              : job.stage === "synth"
              ? `${job.done} / ${job.total} 段`
              : `${percent.toFixed(0)}%`}
          </span>
        )}
        {["generate", "preview", "download", "install", "reference", "transcription", "prepare"].includes(
          job.kind,
        ) && (
          <button
            className="text-button"
            disabled={job.cancelling}
            onClick={onCancel}
          >
            取消
          </button>
        )}
      </div>
      <div className={`progress-track${quantified ? "" : " indeterminate"}`}>
        <div style={quantified ? { width: `${percent}%` } : undefined} />
      </div>
    </div>
  );
}
