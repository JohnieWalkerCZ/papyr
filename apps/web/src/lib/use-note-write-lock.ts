"use client";

import { createUuid } from "./uuid.js";
import { useEffect, useState } from "react";

export function useNoteWriteLock(noteId: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"acquiring" | "writer" | "locked" | "unsupported">("acquiring");
  const [heldNoteId, setHeldNoteId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    if (!navigator.locks) {
      void Promise.resolve().then(() => active && setState("unsupported"));
      return () => {
        active = false;
      };
    }
    let profileId: string;
    try {
      profileId = localStorage.getItem("papyr-profile-id") ?? createUuid();
      localStorage.setItem("papyr-profile-id", profileId);
    } catch {
      void Promise.resolve().then(() => active && setState("unsupported"));
      return () => {
        active = false;
      };
    }
    void navigator.locks
      .request(`papyr-profile:${profileId}:note:${noteId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!active) return;
        if (!lock) {
          setState("locked");
          retryTimer = setTimeout(() => active && setAttempt((value) => value + 1), 750);
          return;
        }
        setHeldNoteId(noteId);
        setState("writer");
        await new Promise<void>((resolve) => (release = resolve));
      })
      .catch(() => active && setState("unsupported"));
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      release?.();
      setHeldNoteId((current) => (current === noteId ? null : current));
    };
  }, [attempt, noteId]);

  const currentState = state === "writer" && heldNoteId !== noteId ? "acquiring" : state;
  return {
    canWrite: currentState === "writer",
    state: currentState,
    retry: () => {
      setState("acquiring");
      setAttempt((value) => value + 1);
    },
  };
}
