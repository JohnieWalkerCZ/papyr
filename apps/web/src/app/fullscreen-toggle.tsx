"use client";

import { useEffect, useState } from "react";
import { Maximize, Minimize } from "lucide-react";
import { useLocale } from "@/lib/locale";

export function FullscreenToggle() {
  const copy = useLocale().library;
  const [fullscreen, setFullscreen] = useState(false);
  // Client component: `document` is available during the initial render.
  const [supported] = useState(() => typeof document !== "undefined" && document.fullscreenEnabled);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // The browser rejected the request (e.g. not triggered by a user gesture); stay as-is.
    }
  }

  if (!supported) return null;
  return (
    <button
      className="icon-button"
      type="button"
      onClick={() => void toggle()}
      aria-label={fullscreen ? copy.exitFullscreen : copy.enterFullscreen}
      title={fullscreen ? copy.exitFullscreen : copy.enterFullscreen}
    >
      {fullscreen ? <Minimize aria-hidden="true" size={18} /> : <Maximize aria-hidden="true" size={18} />}
    </button>
  );
}
