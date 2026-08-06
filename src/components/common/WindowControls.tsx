import { useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Platform = "macos" | "windows" | "linux" | "unknown";

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

const platform = detectPlatform();
const isMac = platform === "macos";

export { isMac };

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  const handleMinimize = useCallback(() => {
    getCurrentWindow().minimize();
  }, []);

  const handleMaximize = useCallback(async () => {
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      win.unmaximize();
      setMaximized(false);
    } else {
      win.maximize();
      setMaximized(true);
    }
  }, []);

  const handleClose = useCallback(() => {
    getCurrentWindow().close();
  }, []);

  if (isMac) return null;

  return (
    <div className="flex items-center h-full">
      <button
        className="window-control-btn window-control-minimize"
        onClick={handleMinimize}
        aria-label="最小化"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        className="window-control-btn window-control-maximize"
        onClick={handleMaximize}
        aria-label={maximized ? "还原" : "最大化"}
      >
        {maximized ? (
          <svg width="9" height="9" viewBox="0 0 9 9">
            <rect x="1.5" y="0" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="0" y="1.5" width="7" height="7" fill="var(--control-bg, #212123)" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="9" height="9" viewBox="0 0 9 9">
            <rect width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        className="window-control-btn window-control-close"
        onClick={handleClose}
        aria-label="关闭"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
