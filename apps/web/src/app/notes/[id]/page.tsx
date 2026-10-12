"use client";

import Image from "next/image";
import {
  Bold,
  Code2,
  FileText,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  MoreHorizontal,
  Presentation,
  Sigma,
} from "lucide-react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  listLocalFolders,
  localDb,
  moveLocalEntity,
  setDeletedLocalEntity,
  storeLocalAttachment,
  updateLocalNote,
  type LocalFolder,
  type LocalNote,
} from "@/lib/local-db";
import { useLocale } from "@/lib/locale";
import { scheduleSync } from "@/lib/sync";
import { useNoteWriteLock } from "@/lib/use-note-write-lock";
import TypstEditor from "../../typst/page";
import WhiteboardEditor from "../../whiteboard/page";
import { DocumentEditorShell } from "../../document-editor-shell";
import { SourceEditor } from "../../source-editor";
import type { EditorView } from "codemirror";

export default function NotePage({ noteId }: { noteId?: string } = {}) {
  const params = useParams<{ id: string }>();
  const id = noteId ?? params.id;
  return <NoteEditor key={id} id={id} />;
}

function NoteEditor({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const writer = useNoteWriteLock(id);
  const [note, setNote] = useState<LocalNote | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<LocalFolder[]>([]);
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<string>(locale.library.noteLoading);
  const [markdownMode, setMarkdownMode] = useState<"edit" | "split" | "preview">("split");
  const typstImageInput = useRef<HTMLInputElement>(null);
  const [folders, setFolders] = useState<LocalFolder[]>([]);
  const [moving, setMoving] = useState(false);
  const [destination, setDestination] = useState("");
  const markdownView = useRef<EditorView | null>(null);
  const moveDialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRef = useRef(source);
  const persistedSource = useRef(source);
  const noteRef = useRef(note);
  const whiteboardDirty = useRef(false);
  const onWhiteboardDirtyChange = useCallback((dirty: boolean) => {
    whiteboardDirty.current = dirty;
  }, []);
  useLayoutEffect(() => {
    noteRef.current = note;
  }, [note]);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);
  useEffect(() => {
    if (moving) moveDialog.current?.showModal();
  }, [moving]);
  useEffect(() => {
    void listLocalFolders().then(setFolders);
  }, [id]);

  useEffect(() => {
    const onEntityUpdated = (event: Event) => {
      if ((event as CustomEvent<{ id: string }>).detail.id !== id) return;
      void localDb.entities.get(id).then((entity) => {
        if (!entity || entity.kind !== "note" || entity.deletedAt) return;
        const current = noteRef.current;
        if (
          !current ||
          (sourceRef.current !== persistedSource.current && current.type !== "whiteboard") ||
          whiteboardDirty.current
        )
          return;
        setNote(entity);
        if (entity.type !== "whiteboard") {
          const content = String(entity.content ?? "");
          sourceRef.current = content;
          persistedSource.current = content;
          setSource(content);
        }
      });
    };
    window.addEventListener("papyr-entity-updated", onEntityUpdated);
    return () => window.removeEventListener("papyr-entity-updated", onEntityUpdated);
  }, [id]);

  useEffect(() => {
    let active = true;
    localDb.entities
      .get(id)
      .then(async (entity) => {
        if (!active) return;
        if (!entity || entity.kind !== "note" || entity.deletedAt) {
          setStatus(locale.library.noteNotFound);
          return;
        }
        const parents: LocalFolder[] = [];
        const seen = new Set<string>();
        let folderId = entity.folderId;
        while (folderId && !seen.has(folderId)) {
          seen.add(folderId);
          const folder = await localDb.entities.get(folderId);
          if (!folder || folder.kind !== "folder") break;
          parents.unshift(folder);
          folderId = folder.parentId;
        }
        setBreadcrumbs(parents);
        if (entity.type === "whiteboard") {
          sourceRef.current = "";
          persistedSource.current = "";
          setNote(entity);
          setSource("");
          setStatus(locale.library.savedLocal);
          return;
        }
        setNote(entity);
        setSource(String(entity.content));
        sourceRef.current = String(entity.content);
        persistedSource.current = String(entity.content);
        setStatus("Saved locally · pending sync");
        scheduleSync();
      })
      .catch(() => active && setStatus(locale.library.loadingError));
    return () => {
      active = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (noteRef.current?.id === id && sourceRef.current !== persistedSource.current)
        void updateLocalNote(id, { content: sourceRef.current }, undefined, noteRef.current?.revision).then(() =>
          scheduleSync(0),
        );
      else scheduleSync(0);
    };
  }, [
    id,
    locale.library.loadingError,
    locale.library.noteNotFound,
    locale.library.pendingSync,
    locale.library.savedLocal,
  ]);

  const persist = useCallback(
    async (value: string) => {
      try {
        if (pathname !== `/notes/${id}`) return;
        const current = noteRef.current;
        if (!current || current.id !== id) throw new Error("The selected note changed. Reopen it before editing.");
        const next = await updateLocalNote(current.id, { content: value }, undefined, current.revision);
        setNote(next);
        persistedSource.current = value;
        setStatus(locale.library.pendingSync);
        scheduleSync();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : locale.library.saveError);
      }
    },
    [id, pathname, locale.library.pendingSync, locale.library.saveError],
  );

  function change(value: string) {
    if (!writer.canWrite || pathname !== `/notes/${id}`) return;
    sourceRef.current = value;
    setSource(value);
    setStatus(locale.library.savingLocal);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void persist(value);
    }, 350);
  }

  const saveNow = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await persist(sourceRef.current);
  }, [persist]);

  useEffect(() => {
    if (note?.type !== "markdown") return;
    const onSave = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener("keydown", onSave);
    return () => window.removeEventListener("keydown", onSave);
  }, [note?.type, saveNow]);

  function exportSource() {
    const extension = note?.type === "typst" ? "typ" : "md";
    const blob = new Blob([source], { type: `text/${extension === "typ" ? "plain" : "markdown"};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${note?.title || "note"}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function applyMarkdown(before: string, after = "", placeholder = "text") {
    const view = markdownView.current;
    if (!view || !writer.canWrite) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || placeholder;
    const text = `${before}${selected}${after}`;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + before.length, head: from + before.length + selected.length },
    });
    view.focus();
  }

  async function saveTitle() {
    if (!note || !writer.canWrite) return;
    try {
      const saved = await updateLocalNote(id, { title: note.title }, undefined, note.revision);
      setNote(saved);
      setStatus(locale.library.pendingSync);
      scheduleSync();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : locale.library.saveError);
    }
  }

  async function moveNote() {
    if (!note || !writer.canWrite) return;
    try {
      await moveLocalEntity(note.id, destination || null);
      setNote({ ...note, folderId: destination || null });
      const all = await listLocalFolders();
      setFolders(all);
      const path: LocalFolder[] = [];
      let parentId = destination || null;
      while (parentId) {
        const folder = all.find((item) => item.id === parentId);
        if (!folder) break;
        path.unshift(folder);
        parentId = folder.parentId;
      }
      setBreadcrumbs(path);
      setMoving(false);
      setStatus(locale.library.pendingSync);
      scheduleSync();
    } catch {
      setStatus(locale.library.saveError);
    }
  }

  async function trashNote() {
    if (!note || !writer.canWrite || !window.confirm(locale.library.confirmDelete(note.title))) return;
    try {
      if (note.type !== "whiteboard") await saveNow();
      await setDeletedLocalEntity(note.id, true);
      scheduleSync();
      router.replace("/");
    } catch {
      setStatus(locale.library.saveError);
    }
  }

  async function addAttachment(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !note || !writer.canWrite) return;
    try {
      const asset = await storeLocalAttachment(file);
      const uri = `papyr-asset://${asset.id}`;
      const reference =
        note.type === "typst" ? `#image("${uri}")` : `![${file.name.replace(/[\\[\\]\\r\\n]/g, " ")}](${uri})`;
      const current = sourceRef.current;
      change(`${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${reference}\n`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : locale.library.saveError);
    }
  }

  if (!note || writer.state === "acquiring")
    return (
      <main className="app-shell">
        <p className="document-loading" role="status">
          {note ? locale.library.writerAcquiring : status}
        </p>
      </main>
    );
  return (
    <DocumentEditorShell note={note} path={breadcrumbs} status={status}>
      <div className="document-editor">
        {!writer.canWrite && (
          <p role="status" className="save-status">
            {writer.state === "locked"
              ? locale.library.writerLocked
              : writer.state === "unsupported"
                ? locale.library.writerUnsupported
                : locale.library.writerAcquiring}
            <button type="button" onClick={writer.retry}>
              {locale.library.retryWriter}
            </button>
          </p>
        )}
        <header className="document-titlebar">
          <span className="document-type-icon" aria-hidden="true">
            {note.type === "typst" ? <Sigma /> : note.type === "whiteboard" ? <Presentation /> : <FileText />}
          </span>
          <div className="document-title-group">
            <small>
              {note.type === "typst"
                ? locale.library.typstType
                : note.type === "whiteboard"
                  ? locale.library.whiteboardType
                  : locale.library.markdownType}
            </small>
            <input
              aria-label="Note title"
              value={note.title}
              readOnly={!writer.canWrite}
              onChange={(event) => writer.canWrite && setNote({ ...note, title: event.target.value })}
              onBlur={() => void saveTitle()}
            />
          </div>
          <p className="save-status" role="status" aria-live="polite">
            {status}
          </p>
          {note.type !== "whiteboard" && (
            <button className="secondary-action" onClick={exportSource}>
              {locale.library.exportSource}
            </button>
          )}
          <details className="item-menu editor-item-menu">
            <summary aria-label={locale.library.actions} title={locale.library.actions}>
              <MoreHorizontal aria-hidden="true" size={18} />
            </summary>
            <div className="item-menu-popover">
              <button
                type="button"
                disabled={!writer.canWrite}
                onClick={() => {
                  setDestination(note.folderId ?? "");
                  setMoving(true);
                }}
              >
                {locale.library.moveTo}
              </button>
              <button
                type="button"
                className="destructive-action"
                disabled={!writer.canWrite}
                onClick={() => void trashNote()}
              >
                {locale.library.remove}
              </button>
            </div>
          </details>
        </header>
        {note.type === "whiteboard" ? (
          <WhiteboardEditor
            noteId={note.id}
            revision={note.revision}
            canWrite={writer.canWrite}
            onDirtyChange={onWhiteboardDirtyChange}
          />
        ) : note.type === "typst" ? (
          <>
            <input
              ref={typstImageInput}
              className="visually-hidden"
              aria-label={locale.library.attachImage}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => void addAttachment(event)}
              disabled={!writer.canWrite}
            />
            <TypstEditor
              embedded
              initialSource={source}
              onSourceChange={change}
              onAddImage={() => typstImageInput.current?.click()}
              readOnly={!writer.canWrite}
            />
          </>
        ) : (
          <>
            <div className="editor-toolbar" role="toolbar" aria-label={locale.library.markdownTools}>
              <div className="toolbar-group" aria-label={locale.library.markdownTools}>
                <button
                  title={locale.library.bold}
                  aria-label={locale.library.bold}
                  onClick={() => applyMarkdown("**", "**")}
                >
                  <Bold aria-hidden="true" size={16} />
                </button>
                <button
                  title={locale.library.italic}
                  aria-label={locale.library.italic}
                  onClick={() => applyMarkdown("*", "*")}
                >
                  <Italic aria-hidden="true" size={16} />
                </button>
                <button
                  title={locale.library.headingAction}
                  aria-label={locale.library.headingAction}
                  onClick={() => applyMarkdown("## ", "", "Heading")}
                >
                  <Heading2 aria-hidden="true" size={16} />
                </button>
              </div>
              <span className="toolbar-divider" aria-hidden="true" />
              <div className="toolbar-group" aria-label={locale.library.content}>
                <button
                  title={locale.library.link}
                  aria-label={locale.library.link}
                  onClick={() => applyMarkdown("[", "](https://)")}
                >
                  <Link2 aria-hidden="true" size={16} />
                </button>
                <button
                  title={locale.library.list}
                  aria-label={locale.library.list}
                  onClick={() => applyMarkdown("- ", "", "List item")}
                >
                  <List aria-hidden="true" size={16} />
                </button>
                <button
                  title={locale.library.codeBlock}
                  aria-label={locale.library.codeBlock}
                  onClick={() => applyMarkdown("```\n", "\n```", "code")}
                >
                  <Code2 aria-hidden="true" size={16} />
                </button>
              </div>
              <label className="editor-image-action" title={locale.library.attachImage}>
                <ImagePlus aria-hidden="true" size={16} />
                {locale.library.attachImage}
                <input
                  aria-label={locale.library.attachImage}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  disabled={!writer.canWrite}
                  onChange={(event) => void addAttachment(event)}
                />
              </label>
              <span className="toolbar-spacer" />
              <div className="mode-segmented" role="group" aria-label={locale.library.markdownView}>
                {(["edit", "split", "preview"] as const).map((mode) => (
                  <button key={mode} aria-pressed={markdownMode === mode} onClick={() => setMarkdownMode(mode)}>
                    {locale.library[mode]}
                  </button>
                ))}
              </div>
            </div>
            <div className={`markdown-grid mode-${markdownMode}`}>
              {markdownMode !== "preview" && (
                <section className="markdown-source">
                  <SourceEditor
                    key={id}
                    editorRef={markdownView}
                    label="Markdown source"
                    value={source}
                    onChange={change}
                    type="markdown"
                    readOnly={!writer.canWrite}
                  />
                </section>
              )}
              {markdownMode !== "edit" && (
                <section className="markdown-preview-pane" aria-label="Preview">
                  <MarkdownPreview source={source} />
                </section>
              )}
            </div>
          </>
        )}
        {moving && (
          <dialog ref={moveDialog} className="move-dialog" onCancel={() => setMoving(false)}>
            <h2>
              {locale.library.moveTo}: {note.title}
            </h2>
            <label htmlFor="document-move-destination">{locale.library.destination}</label>
            <select
              id="document-move-destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            >
              <option value="">{locale.library.root}</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.title}
                </option>
              ))}
            </select>
            <div className="dialog-actions">
              <button className="secondary-action" onClick={() => setMoving(false)}>
                {locale.library.cancel}
              </button>
              <button className="primary-action" onClick={() => void moveNote()}>
                {locale.library.confirmMove}
              </button>
            </div>
          </dialog>
        )}
      </div>
    </DocumentEditorShell>
  );
}

function MarkdownPreview({ source }: { source: string }) {
  const attachmentReferences = [...source.matchAll(/^!\[([^\]]*)\]\(papyr-asset:\/\/([0-9a-f-]{36})\)$/gim)];
  const attachmentIds = [...new Set(attachmentReferences.map((match) => match[2]))];
  const attachmentKey = attachmentIds.join(":");
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const created: string[] = [];
    void Promise.all(
      (attachmentKey ? attachmentKey.split(":") : []).map(async (assetId) => {
        const asset = await localDb.assets.get(assetId);
        if (!asset) return [assetId, ""] as const;
        const url = URL.createObjectURL(asset.blob);
        created.push(url);
        return [assetId, url] as const;
      }),
    ).then((entries) => active && setUrls(Object.fromEntries(entries)));
    return () => {
      active = false;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [attachmentKey]);

  const lines = source.split("\n");
  const blocks: React.ReactNode[] = [];
  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const fence = /^```([^`]*)$/.exec(line);
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const image = /^!\[([^\]]*)\]\(papyr-asset:\/\/([0-9a-f-]{36})\)$/i.exec(line);
    const tableSeparator =
      index + 1 < lines.length && /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[index + 1]);
    if (!line.trim()) {
      index++;
      continue;
    }
    if (fence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(
        <pre key={blocks.length}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
    } else if (image) {
      blocks.push(
        urls[image[2]] ? (
          <Image key={blocks.length} src={urls[image[2]]} alt={image[1]} width={800} height={600} unoptimized />
        ) : (
          <p key={blocks.length}>{image[1]}</p>
        ),
      );
      index++;
    } else if (heading) {
      const Tag = `h${heading[1].length}` as keyof React.JSX.IntrinsicElements;
      blocks.push(<Tag key={blocks.length}>{inlineMarkdown(heading[2])}</Tag>);
      index++;
    } else if (line.includes("|") && tableSeparator) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim());
      const headings = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim())
        rows.push(cells(lines[index++]));
      blocks.push(
        <table key={blocks.length}>
          <thead>
            <tr>
              {headings.map((cell, cellIndex) => (
                <th key={cellIndex}>{inlineMarkdown(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {headings.map((_, cellIndex) => (
                  <td key={cellIndex}>{inlineMarkdown(row[cellIndex] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
    } else if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: string[] = [];
      while (index < lines.length && (ordered ? /^\d+\.\s+/.test(lines[index]) : /^[-*+]\s+/.test(lines[index])))
        items.push(lines[index++].replace(/^(?:[-*+]\s+|\d+\.\s+)/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={blocks.length}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inlineMarkdown(item)}</li>
          ))}
        </List>,
      );
    } else if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={blocks.length}>
          {quote.map((text, itemIndex) => (
            <p key={itemIndex}>{inlineMarkdown(text)}</p>
          ))}
        </blockquote>,
      );
    } else if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={blocks.length} />);
      index++;
    } else {
      const paragraph = [line];
      index++;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^(#{1,6}\s|```|[-*+]\s|\d+\.\s|>\s?|---+$)/.test(lines[index].trimStart())
      )
        paragraph.push(lines[index++]);
      blocks.push(
        <p key={blocks.length}>
          {paragraph.map((text, lineIndex) => (
            <Fragment key={lineIndex}>
              {lineIndex > 0 && <br />}
              {inlineMarkdown(text)}
            </Fragment>
          ))}
        </p>,
      );
    }
  }
  return <div className="markdown-preview">{blocks}</div>;
}

function inlineMarkdown(text: string): React.ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|~~[^~]+~~|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const result: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    if (start > cursor) result.push(text.slice(cursor, start));
    const token = match[0];
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
    if (link) {
      const safe = /^(https?:|mailto:|\/|#)/i.test(link[2]) && !/^\/\//.test(link[2]);
      result.push(
        safe ? (
          <a key={start} href={link[2]}>
            {link[1]}
          </a>
        ) : (
          link[1]
        ),
      );
    } else if (token.startsWith("**")) result.push(<strong key={start}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("~~")) result.push(<del key={start}>{token.slice(2, -2)}</del>);
    else if (token.startsWith("`")) result.push(<code key={start}>{token.slice(1, -1)}</code>);
    else result.push(<em key={start}>{token.slice(1, -1)}</em>);
    cursor = start + token.length;
  }
  if (cursor < text.length) result.push(text.slice(cursor));
  return result;
}
