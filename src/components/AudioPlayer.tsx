import { useEffect, useRef, useState } from "react";
import { mediaURL } from "../api";
import { formatDuration } from "../domain";
import { Icon } from "./Icon";

export function AudioPlayer({
  path,
  duration: expectedDuration = 0,
  onTimeChange,
  seekRequest,
  compact = false,
  autoPlay = false,
  onFinished,
  onInterrupted,
}: {
  path: string;
  duration?: number;
  onTimeChange?: (time: number) => void;
  seekRequest?: { time: number; id: number };
  compact?: boolean;
  autoPlay?: boolean;
  onFinished?: () => void;
  onInterrupted?: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(expectedDuration);
  const [error, setError] = useState("");
  const [rate, setRate] = useState(1);
  const callback = useRef(onTimeChange);
  callback.current = onTimeChange;
  const lifecycle = useRef({ onFinished, onInterrupted });
  lifecycle.current = { onFinished, onInterrupted };
  useEffect(() => {
    const stopOthers = (event: Event) => {
      if ((event as CustomEvent).detail !== audio.current) {
        audio.current?.pause();
        lifecycle.current.onInterrupted?.();
      }
    };
    window.addEventListener("vovo-play", stopOthers);
    return () => {
      window.removeEventListener("vovo-play", stopOthers);
    };
  }, []);
  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setDuration(expectedDuration);
    setError("");
    setRate(1);
    const element = audio.current;
    let active = true;
    if (element) element.playbackRate = 1;
    if (autoPlay)
      void element?.play().catch((error: unknown) => {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) setError("点击播放即可试听");
      });
    return () => { active = false; element?.pause(); };
  }, [path, autoPlay, expectedDuration]);
  useEffect(() => {
    if (seekRequest && audio.current) {
      audio.current.currentTime = seekRequest.time;
      setTime(seekRequest.time);
    }
  }, [seekRequest]);
  async function toggle() {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    try {
      await element.play();
      setError("");
    } catch {
      setError("暂时无法播放，请重试或打开导出的音频文件");
    }
  }
  return (
    <div className={`audio-player${compact ? " compact" : ""}`}>
      <audio
        ref={audio}
        src={mediaURL(path)}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          setError("");
          window.dispatchEvent(
            new CustomEvent("vovo-play", { detail: audio.current }),
          );
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); lifecycle.current.onFinished?.(); }}
        onTimeUpdate={() => {
          const value = audio.current?.currentTime ?? 0;
          setTime(value);
          callback.current?.(value);
        }}
        onLoadedMetadata={() => {
          const value = audio.current?.duration;
          if (value && Number.isFinite(value)) setDuration(value);
        }}
        onError={() => {
          setPlaying(false);
          setError("音频文件无法读取，请重新生成或检查记录");
        }}
      />
      <button
        className="player-play"
        aria-label={playing ? "暂停音频" : "播放音频"}
        onClick={() => void toggle()}
      >
        <Icon name={playing ? "pause" : "play"} size={18} />
      </button>
      <span className="player-time">{formatDuration(time)}</span>
      <input
        className="player-seek"
        aria-label="音频播放位置"
        type="range"
        min={0}
        max={duration || 1}
        step={0.01}
        value={Math.min(time, duration || 1)}
        disabled={!duration}
        onChange={(e) => {
          const value = Number(e.target.value);
          if (audio.current) audio.current.currentTime = value;
          setTime(value);
          callback.current?.(value);
        }}
      />
      <span className="player-time">{formatDuration(duration)}</span>
      {!compact && (
        <select
          className="playback-rate"
          aria-label="播放倍速（不改变导出文件）"
          value={rate}
          onChange={(e) => {
            const value = Number(e.target.value);
            setRate(value);
            if (audio.current) audio.current.playbackRate = value;
          }}
        >
          {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
      )}
      {error && (
        <p className="player-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
