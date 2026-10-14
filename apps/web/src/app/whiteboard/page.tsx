"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, ImagePlus, Maximize, Minimize, Scan, Share } from "lucide-react";
import { getAssetUrls } from "@tldraw/assets/selfHosted";
import { Tldraw, exportAs, getSnapshot, loadSnapshot } from "tldraw";
import type { Editor, TLAssetStore, TLStoreSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import {
  DraftRecoveredError,
  localDb,
  storeLocalAttachment,
  updateLocalNote,
  type LocalWriteLease,
  type LocalNote,
} from "@/lib/local-db";
import { useLocale } from "@/lib/locale";
import { scheduleSync } from "@/lib/sync";

const tldrawAssetUrls = getAssetUrls({ baseUrl: "/tldraw" });

export default function WhiteboardProof({
  noteId,
  database = localDb,
  getWriteLease,
  originalNote,
  onFlushReady,
  revision,
  canWrite = true,
  onDirtyChange,
}: {
  noteId?: string;
  database?: typeof localDb;
  getWriteLease?: () => LocalWriteLease | undefined;
  originalNote?: LocalNote;
  onFlushReady?: (flush: (() => Promise<void>) | undefined) => void;
  revision?: string | null;
  canWrite?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const locale = useLocale();
  const copy = locale.whiteboard;
  const [editor, setEditor] = useState<Editor>();
  const [snapshot, setSnapshot] = useState<unknown>();
  const [status, setStatus] = useState<string>(copy.loading);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const editorRoot = useRef<HTMLElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const latestSnapshot = useRef<unknown>(undefined);
  const assetUrls = useRef(new Map<string, string>());
  const [fullscreen, setFullscreen] = useState(false);
  const canWriteRef = useRef(canWrite);
  const revisionRef = useRef(revision);
  const originalNoteRef = useRef(originalNote);
  useLayoutEffect(() => {
    canWriteRef.current = canWrite;
    revisionRef.current = revision;
    originalNoteRef.current = originalNote;
  }, [canWrite, revision, originalNote]);
  const licenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY;
  const assetStore = useMemo<TLAssetStore>(
    () => ({
      async upload(_asset, file) {
        const saved = await storeLocalAttachment(file, database);
        return { src: `https://papyr.invalid/papyr-assets/${saved.id}` };
      },
      async resolve(asset) {
        const src = asset.props.src;
        if (!src) return null;
        if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)) return src;
        const reference = /^(?:papyr-asset:\/\/|https:\/\/papyr\.invalid\/papyr-assets\/)([0-9a-f-]{36})$/i.exec(src);
        if (!reference) return null;
        const cached = assetUrls.current.get(reference[1]);
        if (cached) return cached;
        const saved = await database.assets.get(reference[1]);
        if (!saved) return null;
        const url = URL.createObjectURL(saved.blob);
        assetUrls.current.set(reference[1], url);
        return url;
      },
    }),
    [database],
  );

  useEffect(() => {
    void Promise.all([
      noteId ? database.entities.get(noteId) : database.snapshots.get("phase-zero-whiteboard"),
      database.snapshots.get(`whiteboard-session:${noteId ?? "phase-zero"}`),
    ])
      .then(([saved, session]) => {
        const value = noteId
          ? saved && "kind" in saved && saved.kind === "note"
            ? saved.content
            : undefined
          : saved && "value" in saved
            ? saved.value
            : undefined;
        const document = value && typeof value === "object" && "document" in value ? value.document : value;
        setSnapshot(document ? { document, session: session?.value } : undefined);
        setReady(true);
      })
      .catch(() => {
        setLoadFailed(true);
        setStatus(copy.loadError);
        setReady(true);
      });
  }, [database, copy.loadError, copy.loading, loadAttempt, noteId]);

  useEffect(() => {
    editor?.user.updateUserPreferences({ colorScheme: "system" });
  }, [editor]);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === editorRoot.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(
    () => () => {
      for (const url of assetUrls.current.values()) URL.revokeObjectURL(url);
      assetUrls.current.clear();
    },
    [],
  );

  function mountEditor(instance: Editor) {
    try {
      if (snapshot && typeof snapshot === "object" && "document" in snapshot)
        loadSnapshot(instance.store, snapshot as Parameters<typeof loadSnapshot>[1]);
      else if (snapshot && typeof snapshot === "object" && "store" in snapshot && "schema" in snapshot)
        loadSnapshot(instance.store, snapshot as TLStoreSnapshot);
    } catch {
      setLoadFailed(true);
      setStatus(copy.loadError);
      return;
    }
    setEditor(instance);
    setStatus(copy.ready);
  }

  const persist = useCallback(
    async (value: unknown) => {
      if (!value) return;
      try {
        const fullSnapshot = value as { document?: unknown; session?: unknown };
        const document = fullSnapshot.document ?? value;
        if (noteId)
          await updateLocalNote(
            noteId,
            { content: document },
            database,
            revisionRef.current,
            getWriteLease?.(),
            originalNoteRef.current,
          );
        else await database.snapshots.put({ id: "phase-zero-whiteboard", value: document, updatedAt: Date.now() });
        if (fullSnapshot.session)
          await database.snapshots.put({
            id: `whiteboard-session:${noteId ?? "phase-zero"}`,
            value: fullSnapshot.session,
            updatedAt: Date.now(),
          });
        if (noteId) scheduleSync();
        if (latestSnapshot.current === value) {
          latestSnapshot.current = undefined;
          onDirtyChange?.(false);
        }
        setStatus(copy.saved);
      } catch (error) {
        if (error instanceof DraftRecoveredError) {
          latestSnapshot.current = undefined;
          onDirtyChange?.(false);
        }
        setStatus(error instanceof DraftRecoveredError ? error.message : copy.saveError);
        throw error;
      }
    },
    [database, getWriteLease, copy.saveError, copy.saved, noteId, onDirtyChange],
  );

  useEffect(() => {
    if (!editor) return;
    const stopListening = editor.store.listen(
      () => {
        if (!canWriteRef.current) return;
        latestSnapshot.current = getSnapshot(editor.store);
        onDirtyChange?.(true);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null;
          void persist(latestSnapshot.current).catch(() => {});
        }, 500);
      },
      { scope: "document", source: "user" },
    );
    return () => {
      stopListening();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (latestSnapshot.current) void persist(latestSnapshot.current).catch(() => {});
    };
  }, [editor, onDirtyChange, persist]);

  useEffect(() => {
    onFlushReady?.(async () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (latestSnapshot.current) await persist(latestSnapshot.current);
    });
    return () => onFlushReady?.(undefined);
  }, [onFlushReady, persist]);

  const save = useCallback(async () => {
    if (!editor || !canWriteRef.current) return;
    setStatus(copy.saving);
    try {
      const value = getSnapshot(editor.store);
      await persist(value);
    } catch {
      setStatus(copy.saveError);
    }
  }, [copy.saveError, copy.saving, editor, persist]);

  useEffect(() => {
    const onSave = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onSave);
    return () => window.removeEventListener("keydown", onSave);
  }, [save]);

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await editorRoot.current?.requestFullscreen();
  }

  function exportSnapshot() {
    if (!editor) return;
    const blob = new Blob([JSON.stringify(getSnapshot(editor.store).document, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "whiteboard.tldr.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportImage(format: "png" | "svg") {
    if (!editor) return;
    try {
      await exportAs(editor, [...editor.getCurrentPageShapeIds()], { format, name: "whiteboard" });
    } catch {
      setStatus(copy.exportError);
    }
  }

  if (process.env.NODE_ENV === "production" && !licenseKey) {
    return (
      <main className="prototype-page">
        <p>
          <Link href="/">{locale.common.back}</Link>
        </p>
        <h1>{copy.unavailable}</h1>
        <p>{copy.license}</p>
      </main>
    );
  }

  return (
    <section className={noteId ? "whiteboard-editor" : "prototype-page"} ref={editorRoot}>
      {!noteId && (
        <>
          <p>
            <Link href="/">{locale.common.back}</Link>
          </p>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </>
      )}
      <input
        ref={imageInput}
        className="visually-hidden"
        aria-label={locale.library.attachImage}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file && editor && canWriteRef.current)
            void editor.putExternalContent({
              type: "files",
              files: [file],
              point: editor.getViewportPageBounds().center,
            });
        }}
        disabled={!canWrite}
      />
      <div className="whiteboard-toolbar" role="toolbar" aria-label={copy.title}>
        <button
          className="icon-button"
          type="button"
          onClick={() => imageInput.current?.click()}
          disabled={!editor || !canWrite}
          aria-label={locale.library.attachImage}
          title={locale.library.attachImage}
        >
          <ImagePlus aria-hidden="true" size={18} />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => editor?.zoomToFit()}
          disabled={!editor}
          aria-label={copy.fit}
          title={copy.fit}
        >
          <Scan aria-hidden="true" size={18} />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => void toggleFullscreen()}
          disabled={!editor}
          aria-label={fullscreen ? copy.exitFullscreen : copy.enterFullscreen}
          title={fullscreen ? copy.exitFullscreen : copy.enterFullscreen}
        >
          {fullscreen ? <Minimize aria-hidden="true" size={16} /> : <Maximize aria-hidden="true" size={16} />}
        </button>
        <details
          className="whiteboard-export"
          ref={exportMenu}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              exportMenu.current?.removeAttribute("open");
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary className="icon-button" aria-label={copy.export} title={copy.export}>
            <Share aria-hidden="true" size={18} />
          </summary>
          <div className="whiteboard-export-menu">
            <button
              type="button"
              onClick={() => {
                exportMenu.current?.removeAttribute("open");
                exportSnapshot();
              }}
              disabled={!editor}
            >
              <Download aria-hidden="true" size={16} />
              {copy.exportSnapshot}
            </button>
            <button
              type="button"
              onClick={() => {
                exportMenu.current?.removeAttribute("open");
                void exportImage("png");
              }}
              disabled={!editor}
            >
              <Download aria-hidden="true" size={16} />
              {copy.exportPng}
            </button>
            <button
              type="button"
              onClick={() => {
                exportMenu.current?.removeAttribute("open");
                void exportImage("svg");
              }}
              disabled={!editor}
            >
              <Download aria-hidden="true" size={16} />
              {copy.exportSvg}
            </button>
          </div>
        </details>
        <p role="status" aria-live="polite" className="whiteboard-status">
          {status}
        </p>
      </div>
      <div className="canvas" inert={!canWrite}>
        {loadFailed ? (
          <div className="whiteboard-load-error" role="alert">
            <p>{copy.loadError}</p>
            <button
              type="button"
              onClick={() => {
                setReady(false);
                setLoadFailed(false);
                setStatus(copy.loading);
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              {locale.common.retry}
            </button>
          </div>
        ) : ready ? (
          <Tldraw
            assets={assetStore}
            assetUrls={tldrawAssetUrls}
            onMount={mountEditor}
            licenseKey={licenseKey}
            colorScheme="system"
          />
        ) : null}
      </div>
    </section>
  );
}
