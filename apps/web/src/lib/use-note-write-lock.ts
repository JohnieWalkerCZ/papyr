"use client";

import { createUuid } from "./uuid.js";
import { localDb, type LocalSyncMeta } from "./local-db";
import { useEffect, useState } from "react";

export function useNoteWriteLock(noteId: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"acquiring" | "writer" | "locked" | "unsupported">("acquiring");
  const [heldNoteId, setHeldNoteId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
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
    if (!navigator.locks) {
      const lockKey = `note:${profileId}:${noteId}`;
      const lockOwner = createUuid();
      void localDb
        .transaction("rw", localDb.syncMeta, async () => {
          const current = await localDb.syncMeta.get(lockKey);
          if (current?.lockExpiresAt && current.lockExpiresAt > Date.now()) return false;
          const lock: LocalSyncMeta = {
            id: lockKey,
            cursor: null,
            bootstrapToken: null,
            acceptedOperationIds: [],
            lockOwner,
            lockExpiresAt: Date.now() + 30_000,
            updatedAt: Date.now(),
          };
          await localDb.syncMeta.put(lock);
          return true;
        })
        .then((acquired) => {
          if (!active) {
            if (acquired)
              void localDb.transaction("rw", localDb.syncMeta, async () => {
                if ((await localDb.syncMeta.get(lockKey))?.lockOwner === lockOwner)
                  await localDb.syncMeta.delete(lockKey);
              });
            return;
          }
          if (!acquired) {
            setState("locked");
            retryTimer = setTimeout(() => active && setAttempt((value) => value + 1), 750);
            return;
          }
          setHeldNoteId(noteId);
          setState("writer");
          const renew = () =>
            void localDb
              .transaction("rw", localDb.syncMeta, async () => {
                const current = await localDb.syncMeta.get(lockKey);
                if (current?.lockOwner === lockOwner)
                  await localDb.syncMeta.put({ ...current, lockExpiresAt: Date.now() + 30_000 });
              })
              .catch(() => active && setState("unsupported"));
          const heartbeat = setInterval(renew, 10_000);
          release = () => {
            clearInterval(heartbeat);
            void localDb.transaction("rw", localDb.syncMeta, async () => {
              if ((await localDb.syncMeta.get(lockKey))?.lockOwner === lockOwner)
                await localDb.syncMeta.delete(lockKey);
            });
          };
        })
        .catch(() => active && setState("unsupported"));
      return () => {
        active = false;
        if (retryTimer) clearTimeout(retryTimer);
        release?.();
        setHeldNoteId((current) => (current === noteId ? null : current));
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
