"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/locale";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallPwa() {
  const copy = useLocale().library;
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return (
    <>
      {prompt && (
        <button
          type="button"
          onClick={() =>
            void prompt
              .prompt()
              .catch(() => {})
              .finally(() => setPrompt(null))
          }
        >
          {copy.installApp}
        </button>
      )}
      <p className="dialog-note">{copy.installIosHelp}</p>
    </>
  );
}
