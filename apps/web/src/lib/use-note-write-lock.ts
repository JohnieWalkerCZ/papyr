"use client";

import { createUuid } from "./uuid.js";
import {
  acquireLocalLease,
  DraftRecoveredError,
  localDb,
  ownsLocalLease,
  releaseLocalLease,
  renewLocalLease,
  transferLocalLease,
  type LocalWriteLease,
} from "./local-db";
import { useCallback, useEffect, useRef, useState } from "react";

export function useNoteWriteLock(noteId: string, flush: () => Promise<void>, reload: () => Promise<void>) {
  const [database] = useState(() => localDb);
  const [state, setState] = useState<"acquiring" | "writer" | "locked" | "unsupported">("acquiring");
  const lease = useRef<LocalWriteLease | undefined>(undefined);
  const flushRef = useRef(flush);
  const reloadRef = useRef(reload);
  const requestHandoff = useRef<() => void>(() => {});
  useEffect(() => {
    flushRef.current = flush;
    reloadRef.current = reload;
  }, [flush, reload]);

  useEffect(() => {
    let active = true;
    let relinquished = false;
    let handingOff = false;
    let acquiring = false;
    let held = false;
    let lastRenewed = 0;
    let legacyKey: string | undefined;
    try {
      const profileId = localStorage.getItem("papyr-profile-id");
      if (profileId) legacyKey = `note:${profileId}:${noteId}`;
    } catch {
      /* IndexedDB ownership does not depend on preference storage. */
    }
    const current = { id: `note:${noteId}`, owner: createUuid() };
    const messages =
      typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`papyr-editor:${database.name}`) : undefined;

    const acquire = async () => {
      if (!active || relinquished || acquiring || held || database !== localDb) return;
      acquiring = true;
      try {
        const acquired = await database.transaction("rw", database.syncMeta, async () => {
          // Respect an older HTTP editor until its existing lease expires.
          const legacy = legacyKey ? await database.syncMeta.get(legacyKey) : undefined;
          if ((legacy?.lockExpiresAt ?? 0) > Date.now()) return false;
          return (await ownsLocalLease(current, database)) || acquireLocalLease(current.id, current.owner, database);
        });
        if (acquired) {
          if (!active) {
            await releaseLocalLease(current, database);
            return;
          }
          lease.current = { ...current };
          held = true;
          lastRenewed = Date.now();
          // Reload after obtaining the lease, before enabling inputs.
          await reloadRef.current();
          if (active && (await ownsLocalLease(current, database))) setState("writer");
        } else setState("locked");
      } catch {
        if (held) {
          held = false;
          await releaseLocalLease(current, database);
        }
        if (active) setState("unsupported");
      } finally {
        acquiring = false;
      }
    };
    const handoff = async (requester: string) => {
      if (!held || handingOff) return;
      handingOff = true;
      relinquished = true;
      setState("locked");
      try {
        // Freeze input first, then flush all editor types before releasing ownership.
        await flushRef.current();
        await transferLocalLease(current, requester, database);
        held = false;
        messages?.postMessage({ type: "EDITOR_RELEASED", id: noteId });
      } catch {
        relinquished = false;
        if (active && (await ownsLocalLease(current, database))) setState("writer");
      } finally {
        handingOff = false;
      }
    };
    if (messages)
      messages.onmessage = (event) => {
        if (event.data?.id !== noteId) return;
        if (event.data.type === "EDITOR_REQUESTED" && typeof event.data.owner === "string")
          void handoff(event.data.owner);
        if (event.data.type === "EDITOR_RELEASED") void acquire();
      };
    requestHandoff.current = () => {
      void (async () => {
        try {
          await flushRef.current();
        } catch (error) {
          if (!(error instanceof DraftRecoveredError)) return;
        }
        if (handingOff || acquiring) return;
        current.owner = createUuid();
        relinquished = false;
        messages?.postMessage({ type: "EDITOR_REQUESTED", id: noteId, owner: current.owner });
        void acquire();
      })();
    };
    const onPageHide = () => {
      relinquished = true;
      if (!held) return;
      void flushRef
        .current()
        .then(() => releaseLocalLease(current, database))
        .then(() => {
          held = false;
        })
        .catch(() => {});
    };
    const onPageShow = () => {
      relinquished = false;
      void acquire();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    void acquire();
    const heartbeat = setInterval(() => {
      if (!held) {
        void acquire();
        return;
      }
      if (Date.now() - lastRenewed < 10_000) return;
      lastRenewed = Date.now();
      void renewLocalLease(current, database)
        .then((renewed) => {
          if (!renewed || localDb !== database) {
            held = false;
            relinquished = true;
            if (active) setState("locked");
            void flushRef.current().catch(() => {});
          }
        })
        .catch(() => active && setState("unsupported"));
    }, 1000);
    return () => {
      active = false;
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      clearInterval(heartbeat);
      messages?.close();
      // Navigation flushes before ownership is released, including debounced drafts.
      void flushRef
        .current()
        .then(() => releaseLocalLease(current, database))
        .catch(() => {});
    };
  }, [database, noteId]);

  return {
    database,
    canWrite: state === "writer",
    state,
    getLease: useCallback(() => lease.current, []),
    retry: useCallback(() => requestHandoff.current(), []),
  };
}
