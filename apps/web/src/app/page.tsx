"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import {
  createFolder,
  localDb,
  listLocalFolders,
  listLocalNotes,
  listLocalTrash,
  moveLocalEntity,
  renameLocalEntity,
  setDeletedLocalEntity,
  type LocalEntity,
  type LocalFolder,
  type LocalNote,
} from "@/lib/local-db";
import { LocaleSettingsControls, useLocale } from "@/lib/locale";
import { AuthPanel } from "./auth-panel";
import { initializeSyncTriggers, localConflicts, resolveConflict, scheduleSync, syncLocalLibrary } from "@/lib/sync";
import type { LocalConflict } from "@/lib/local-db";
import { compareTextVersions } from "@/lib/conflict-diff";
import { CreateActions, CreateMenu } from "./document-creation-menu";
import { createLocalDocument } from "@/lib/create-document";

type View = "library" | "trash" | "search";
type SortBy = "name" | "modified" | "created";
const OfflineNotePage = lazy(() => import("./notes/[id]/page"));

export default function Home() {
  const copy = useLocale().library;
  const common = useLocale().common;
  const router = useRouter();
  const pathname = usePathname();
  const [folders, setFolders] = useState<LocalFolder[]>([]);
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [trash, setTrash] = useState<LocalEntity[]>([]);
  const [conflicts, setConflicts] = useState<LocalConflict[]>([]);
  const [activeConflict, setActiveConflict] = useState<LocalConflict | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [dismissedConflictKey, setDismissedConflictKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(copy.loading);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const notePath = pathname.match(/^\/notes\/([^/]+)\/?$/);
  const offlineNoteId = notePath ? decodeURIComponent(notePath[1]) : null;
  const [view, setView] = useState<View>("library");
  const [sortBy, setSortBy] = useState<SortBy>("modified");
  const [query, setQuery] = useState("");
  const [creatingParent, setCreatingParent] = useState<string | null | undefined>(undefined);
  const [folderName, setFolderName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [movingItem, setMovingItem] = useState<LocalEntity | null>(null);
  const [destinationId, setDestinationId] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [searchDialog, setSearchDialog] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const folderInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const quickSearchDialog = useRef<HTMLDialogElement>(null);
  const moveDialog = useRef<HTMLDialogElement>(null);
  const conflictDialog = useRef<HTMLDialogElement>(null);
  const conflictKey = conflicts
    .map(({ id }) => id)
    .sort()
    .join("|");

  async function refresh() {
    const [allFolders, allNotes, deleted, pendingConflicts] = await Promise.all([
      listLocalFolders(),
      listLocalNotes(),
      listLocalTrash(),
      localConflicts(),
    ]);
    setFolders(allFolders);
    setNotes(allNotes);
    setTrash(deleted);
    setConflicts(pendingConflicts);
  }

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.ready.then(() => import("./notes/[id]/page"));
    else void import("./notes/[id]/page");
    try {
      const savedFolder = localStorage.getItem("papyr-library-folder");
      const params = new URLSearchParams(window.location.search);
      const requestedFolder = params.get("folder");
      const requestedView = new URLSearchParams(window.location.search).get("view");
      const savedExpanded = JSON.parse(localStorage.getItem("papyr-folder-expanded") || "[]") as string[];
      const savedSort = localStorage.getItem("papyr-library-sort");
      queueMicrotask(() => {
        if (params.has("folder")) setSelectedFolder(requestedFolder === "root" ? null : requestedFolder);
        else if (savedFolder) setSelectedFolder(savedFolder);
        if (requestedView === "trash") setView("trash");
        setExpanded(savedExpanded);
        setCollapsed(localStorage.getItem("papyr-sidebar-collapsed") === "true");
        if (savedSort === "name" || savedSort === "modified" || savedSort === "created") setSortBy(savedSort);
      });
    } catch {
      // Navigation remains usable for this session when browser storage is unavailable.
    }
    initializeSyncTriggers();
    const onSyncState = (event: Event) => {
      const detail = (event as CustomEvent<{ state: string; message: string }>).detail;
      const labels: Record<string, string> = {
        syncing: copy.syncing,
        synced: copy.synced,
        offline: copy.offline,
        error: copy.syncError,
        conflict: copy.conflictStatus,
        authRequired: copy.authRequired,
      };
      setStatus(labels[detail.state] ?? detail.message);
      void refresh();
    };
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !target.isContentEditable &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
      ) {
        event.preventDefault();
        setSearchDialog(true);
      }
    };
    window.addEventListener("papyr-sync-state", onSyncState);
    window.addEventListener("keydown", onShortcut);
    queueMicrotask(() => {
      void refresh()
        .then(async () => {
          setStatus((await localDb.outbox.count()) ? copy.pendingSync : copy.savedLocal);
          if (new URLSearchParams(window.location.search).get("view") === "conflicts") openConflictCenter();
        })
        .catch(() => setStatus(copy.loadingError));
    });
    return () => {
      window.removeEventListener("papyr-sync-state", onSyncState);
      window.removeEventListener("keydown", onShortcut);
    };
  }, [copy]);

  useEffect(() => {
    if (creatingParent !== undefined) folderInput.current?.focus();
  }, [creatingParent]);
  useEffect(() => {
    if (renameId) renameInput.current?.focus();
  }, [renameId]);
  useEffect(() => {
    if (searchDialog) searchInput.current?.focus();
  }, [searchDialog]);
  useEffect(() => {
    if (searchDialog) quickSearchDialog.current?.showModal();
  }, [searchDialog]);
  useEffect(() => {
    if (movingItem) moveDialog.current?.showModal();
  }, [movingItem]);
  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const path = event.composedPath();
      document.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => {
        const clickedNewButton = path.some((target) => target instanceof Element && target.matches(".new-button"));
        if (!path.includes(menu) && !(menu.classList.contains("create-menu") && clickedNewButton))
          menu.removeAttribute("open");
      });
    };
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  }, []);

  function selectFolder(id: string | null) {
    setSelectedFolder(id);
    setView("library");
    setMobileNav(false);
    try {
      if (id) localStorage.setItem("papyr-library-folder", id);
      else localStorage.removeItem("papyr-library-folder");
    } catch {
      // The selected folder remains active for this page session.
    }
  }

  function toggleFolder(id: string) {
    setExpanded((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      try {
        localStorage.setItem("papyr-folder-expanded", JSON.stringify(next));
      } catch {
        // Expanded state remains active for this page session.
      }
      return next;
    });
  }

  function setSidebarCollapsed(value: boolean) {
    setCollapsed(value);
    try {
      localStorage.setItem("papyr-sidebar-collapsed", String(value));
    } catch {
      // Keep the current layout for this page session.
    }
  }

  function changeSort(value: SortBy) {
    setSortBy(value);
    try {
      localStorage.setItem("papyr-library-sort", value);
    } catch {
      // Keep the selected order for this page session.
    }
  }

  function sortItems<T extends LocalEntity>(items: T[]) {
    return [...items].sort((a, b) =>
      sortBy === "name"
        ? a.title.localeCompare(b.title)
        : sortBy === "created"
          ? b.createdAt - a.createdAt
          : b.updatedAt - a.updatedAt,
    );
  }

  async function createDocument(type: LocalNote["type"], destination = selectedFolder) {
    try {
      const title =
        type === "typst" ? copy.untitledTypst : type === "whiteboard" ? copy.untitledWhiteboard : copy.untitled;
      const note = await createLocalDocument(type, title, destination);
      setStatus(copy.pendingSync);
      window.location.href = new URL(`/notes/${note.id}`, window.location.origin).href;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : copy.saveError);
    }
  }

  function startFolder(parentId: string | null) {
    setCreatingParent(parentId);
    setFolderName("");
    if (parentId) {
      setExpanded((current) => {
        const next = current.includes(parentId) ? current : [...current, parentId];
        try {
          localStorage.setItem("papyr-folder-expanded", JSON.stringify(next));
        } catch {
          // Keep the parent open for this page session.
        }
        return next;
      });
    }
  }

  async function saveFolder() {
    if (creatingParent === undefined || !folderName.trim()) return;
    try {
      const folder = await createFolder(folderName, creatingParent);
      setCreatingParent(undefined);
      setFolderName("");
      await refresh();
      selectFolder(folder.id);
      setStatus(copy.pendingSync);
      scheduleSync();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : copy.saveError);
      folderInput.current?.focus();
    }
  }

  async function saveRename() {
    if (!renameId || !renameValue.trim()) return;
    try {
      await renameLocalEntity(renameId, renameValue);
      setRenameId(null);
      await refresh();
      setStatus(copy.pendingSync);
      scheduleSync();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : copy.renameError);
      renameInput.current?.focus();
    }
  }

  async function remove(item: LocalEntity) {
    if (!window.confirm(copy.confirmDelete(item.title))) return;
    try {
      await setDeletedLocalEntity(item.id, true);
      if (item.kind === "folder" && folderPath.some((folder) => folder.id === item.id)) selectFolder(item.parentId);
      await refresh();
      setStatus(copy.pendingSync);
      scheduleSync();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : copy.saveError);
    }
  }

  async function restore(item: LocalEntity) {
    await setDeletedLocalEntity(item.id, false);
    await refresh();
    setStatus(copy.pendingSync);
    scheduleSync();
  }

  async function confirmMove() {
    if (!movingItem) return;
    try {
      await moveLocalEntity(movingItem.id, destinationId || null);
      setMovingItem(null);
      await refresh();
      setStatus(copy.pendingSync);
      scheduleSync();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : copy.saveError);
    }
  }

  async function chooseConflict(conflict: LocalConflict, action: "remote" | "copy" | "overwrite") {
    if (conflictBusy || (action === "remote" && conflict.local.kind !== "note")) return;
    const confirmation =
      action === "overwrite" ? copy.confirmOverwrite : action === "remote" ? copy.confirmKeepServer : copy.confirmCopy;
    if (!window.confirm(confirmation)) return;
    setConflictBusy(true);
    try {
      await resolveConflict(conflict, action, copy.localCopySuffix);
      setActiveConflict(null);
      await refresh();
      setStatus(copy.conflictResolved);
    } catch {
      setStatus(copy.conflictError);
    } finally {
      setConflictBusy(false);
    }
  }

  function openConflictCenter(conflict: LocalConflict | null = null) {
    setActiveConflict(conflict);
    conflictDialog.current?.showModal();
  }

  const folderPathFor = (folderId: string | null) => {
    const path: string[] = [];
    let current = folders.find((folder) => folder.id === folderId);
    while (current) {
      path.unshift(current.title);
      current = folders.find((folder) => folder.id === current?.parentId);
    }
    return path.length ? path.join(" / ") : copy.root;
  };

  const visibleFolders = folders.filter(
    (folder) => !query.trim() || folder.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const visibleNotes = sortItems(
    notes.filter((note) => {
      if (view === "search" || query.trim())
        return `${note.title}\n${typeof note.content === "string" ? note.content : ""}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase());
      return note.folderId === selectedFolder;
    }),
  );
  const filteredFolders = (parentId: string | null) =>
    sortItems(
      visibleFolders.filter(
        (folder) =>
          folder.parentId === parentId &&
          (view === "search" || !query.trim() || folder.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
      ),
    );
  const selected = folders.find((folder) => folder.id === selectedFolder) ?? null;
  const folderPath = (() => {
    const path: LocalFolder[] = [];
    let current = selected;
    while (current) {
      path.unshift(current);
      current = folders.find((folder) => folder.id === current?.parentId) ?? null;
    }
    return path;
  })();
  const quickMatches = useMemo(() => {
    const term = searchText.trim().toLocaleLowerCase();
    return term
      ? notes
          .filter((note) =>
            `${note.title}\n${typeof note.content === "string" ? note.content : ""}`.toLocaleLowerCase().includes(term),
          )
          .slice(0, 12)
      : notes.slice(0, 8);
  }, [notes, searchText]);
  const validDestinations = folders.filter((folder) => {
    if (movingItem?.kind !== "folder") return true;
    if (folder.id === movingItem.id) return false;
    let parentId: string | null = folder.parentId;
    while (parentId) {
      if (parentId === movingItem.id) return false;
      parentId = folders.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
    return true;
  });

  function canDrop(item: LocalEntity, destination: string | null) {
    if ((item.kind === "folder" ? item.parentId : item.folderId) === destination || item.id === destination)
      return false;
    if (item.kind !== "folder" || !destination) return true;
    let parentId: string | null = destination;
    while (parentId) {
      if (parentId === item.id) return false;
      parentId = folders.find((folder) => folder.id === parentId)?.parentId ?? null;
    }
    return true;
  }

  function startDrag(event: ReactDragEvent<HTMLElement>, item: LocalEntity) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    setDraggedId(item.id);
  }

  function openItemContextMenu(event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    const menu = event.currentTarget.querySelector<HTMLDetailsElement>("details.item-menu");
    menu?.setAttribute("open", "");
    menu?.querySelector<HTMLElement>("summary")?.focus();
  }

  async function dropItem(event: ReactDragEvent<HTMLElement>, destinationId: string | null) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || draggedId;
    const item = [...folders, ...notes].find((entity) => entity.id === id);
    setDraggedId(null);
    setDragOverId(null);
    if (!item || !canDrop(item, destinationId)) return;
    try {
      await moveLocalEntity(item.id, destinationId);
      await refresh();
      scheduleSync();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : copy.saveError);
    }
  }

  function renderRename(item: LocalEntity) {
    return renameId === item.id ? (
      <input
        ref={renameInput}
        className="inline-name"
        aria-label={copy.rename}
        value={renameValue}
        onChange={(event) => setRenameValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void saveRename();
          if (event.key === "Escape") setRenameId(null);
        }}
      />
    ) : (
      <span className="tree-label">{item.title}</span>
    );
  }

  function itemMenu(item: LocalEntity) {
    return (
      <details
        className="item-menu"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.removeAttribute("open");
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}
      >
        <summary aria-label={`${copy.actions}: ${item.title}`} title={copy.actions}>
          <Icon name="more" />
        </summary>
        <div
          className="item-menu-popover"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button"))
              event.currentTarget.closest("details")?.removeAttribute("open");
          }}
        >
          {item.kind === "folder" && (
            <>
              <button
                type="button"
                onClick={() => {
                  selectFolder(item.id);
                  startFolder(item.id);
                }}
              >
                {copy.newSubfolder}
              </button>
              <CreateActions
                copy={copy}
                parentId={item.id}
                onCreate={(type, parentId) => void createDocument(type, parentId)}
              />
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setRenameId(item.id);
              setRenameValue(item.title);
            }}
          >
            {copy.rename}
          </button>
          <button
            type="button"
            onClick={() => {
              setMovingItem(item);
              setDestinationId(item.kind === "folder" ? (item.parentId ?? "") : (item.folderId ?? ""));
            }}
          >
            {copy.moveTo}
          </button>
          <button type="button" className="destructive-action" onClick={() => void remove(item)}>
            {copy.remove}
          </button>
        </div>
      </details>
    );
  }

  function folderTree(parentId: string | null, depth = 0): ReactNode {
    return (
      <>
        {filteredFolders(parentId).map((folder) => (
          <div
            className="tree-branch"
            key={folder.id}
            role="treeitem"
            aria-selected={selectedFolder === folder.id && view === "library"}
            aria-level={depth + 1}
            aria-expanded={expanded.includes(folder.id)}
          >
            <div
              className={`tree-row ${selectedFolder === folder.id && view === "library" ? "is-selected" : ""} ${dragOverId === folder.id ? "drop-target" : ""}`}
              style={{ "--depth": depth } as React.CSSProperties}
              onContextMenu={openItemContextMenu}
              onDragOver={(event) => {
                const item = [...folders, ...notes].find((entity) => entity.id === draggedId);
                if (item && canDrop(item, folder.id)) {
                  event.preventDefault();
                  setDragOverId(folder.id);
                }
              }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={(event) => void dropItem(event, folder.id)}
            >
              <button
                className="tree-disclosure"
                aria-label={expanded.includes(folder.id) ? copy.collapse : copy.expand}
                aria-expanded={expanded.includes(folder.id)}
                onClick={() => toggleFolder(folder.id)}
              >
                <Icon name={expanded.includes(folder.id) ? "down" : "right"} />
              </button>
              <button
                className="tree-open"
                onClick={() => selectFolder(folder.id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const rows = [...document.querySelectorAll<HTMLButtonElement>(".folder-tree .tree-open")];
                    const index = rows.indexOf(event.currentTarget);
                    rows[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
                  } else if (event.key === "ArrowRight" && !expanded.includes(folder.id)) {
                    event.preventDefault();
                    toggleFolder(folder.id);
                  } else if (event.key === "ArrowLeft" && expanded.includes(folder.id)) {
                    event.preventDefault();
                    toggleFolder(folder.id);
                  } else if (event.key === "ArrowLeft" && folder.parentId) {
                    event.preventDefault();
                    document
                      .querySelector<HTMLButtonElement>(`.tree-open[data-folder-id="${folder.parentId}"]`)
                      ?.focus();
                  }
                }}
                data-folder-id={folder.id}
              >
                <Icon name="folder" />
                {renderRename(folder)}
              </button>
              {itemMenu(folder)}
            </div>
            {expanded.includes(folder.id) && <div role="group">{folderTree(folder.id, depth + 1)}</div>}
          </div>
        ))}
      </>
    );
  }

  function noteRow(note: LocalNote) {
    return (
      <div
        className="content-row"
        key={note.id}
        draggable
        onContextMenu={openItemContextMenu}
        onDragStart={(event) => startDrag(event, note)}
        onDragEnd={() => {
          setDraggedId(null);
          setDragOverId(null);
        }}
      >
        {renameId === note.id ? (
          <div className="content-open">
            <Icon name={note.type === "markdown" ? "note" : note.type === "typst" ? "typst" : "board"} />
            {renderRename(note)}
          </div>
        ) : (
          <Link href={`/notes/${note.id}`} className="content-open">
            <Icon name={note.type === "markdown" ? "note" : note.type === "typst" ? "typst" : "board"} />
            <span className="content-title">{note.title}</span>
            <span className="file-type">{note.type}</span>
            <time dateTime={new Date(note.updatedAt).toISOString()}>
              {new Date(note.updatedAt).toLocaleDateString()}
            </time>
          </Link>
        )}
        {itemMenu(note)}
      </div>
    );
  }

  function folderRow(folder: LocalFolder) {
    return (
      <div
        className={`content-row ${dragOverId === folder.id ? "drop-target" : ""}`}
        key={folder.id}
        draggable
        onContextMenu={openItemContextMenu}
        onDragStart={(event) => startDrag(event, folder)}
        onDragEnd={() => {
          setDraggedId(null);
          setDragOverId(null);
        }}
        onDragOver={(event) => {
          if (draggedId && canDrop([...folders, ...notes].find((entity) => entity.id === draggedId)!, folder.id)) {
            event.preventDefault();
            setDragOverId(folder.id);
          }
        }}
        onDragLeave={() => setDragOverId(null)}
        onDrop={(event) => void dropItem(event, folder.id)}
      >
        <button className="content-open" onClick={() => selectFolder(folder.id)}>
          <Icon name="folder" />
          {renderRename(folder)}
          <span className="file-type">{copy.folder}</span>
        </button>
        {itemMenu(folder)}
      </div>
    );
  }

  if (offlineNoteId)
    return (
      <Suspense
        fallback={
          <p className="offline-editor-loading" role="status">
            {copy.loading}
          </p>
        }
      >
        <OfflineNotePage key={offlineNoteId} noteId={offlineNoteId} />
      </Suspense>
    );

  return (
    <main className={`app-shell ${collapsed ? "sidebar-collapsed" : ""} ${mobileNav ? "mobile-nav-open" : ""}`}>
      <header className="app-header">
        <button
          className="icon-button mobile-menu-button"
          aria-label={copy.openNavigation}
          onClick={() => setMobileNav((open) => !open)}
        >
          <Icon name="menu" />
        </button>
        <Link className="app-brand" href="/">
          <span className="brand-mark">p</span>
          <span>Papyr</span>
        </Link>
        <button
          className="icon-button sidebar-toggle"
          aria-label={collapsed ? copy.expandSidebar : copy.collapseSidebar}
          onClick={() => setSidebarCollapsed(!collapsed)}
        >
          <Icon name={collapsed ? "panelRight" : "panelLeft"} />
        </button>
        <nav className="header-breadcrumbs" aria-label={copy.breadcrumb}>
          {view === "search" ? (
            <span>{copy.searchResults}</span>
          ) : view === "trash" ? (
            <span>{copy.trash}</span>
          ) : (
            <>
              <button onClick={() => selectFolder(null)}>{copy.library}</button>
              {folderPath.map((folder) => (
                <span key={folder.id}>
                  <span className="breadcrumb-separator">/</span>
                  <button onClick={() => selectFolder(folder.id)}>{folder.title}</button>
                </span>
              ))}
            </>
          )}
        </nav>
        <div className="header-actions">
          <details className="sync-menu">
            <summary
              className={`sync-indicator ${conflicts.length ? "has-conflicts" : ""} ${status === copy.synced ? "is-good" : status === copy.syncing ? "is-syncing" : status === copy.pendingSync || status === copy.offline || status === copy.authRequired ? "is-pending" : status === copy.syncError ? "is-error" : ""}`}
              aria-label={`${copy.syncStatus}: ${conflicts.length ? copy.conflictCount(conflicts.length) : status}`}
            >
              {conflicts.length > 0 && (
                <span className="sync-warning" aria-hidden="true">
                  <Icon name="warning" />
                </span>
              )}
              {!conflicts.length && <span className="sync-dot" />}
              <span aria-live="polite">{conflicts.length ? copy.conflictCountShort(conflicts.length) : status}</span>
            </summary>
            <div className="sync-popover">
              <strong>{copy.syncStatus}</strong>
              <p role="status">{status}</p>
              {conflicts.length > 0 && (
                <button type="button" onClick={() => openConflictCenter()}>
                  {copy.reviewConflicts}
                </button>
              )}
              <button type="button" onClick={() => void syncLocalLibrary()}>
                <Icon name="refresh" />
                {copy.syncNow}
              </button>
            </div>
          </details>
          <button
            className="icon-button"
            aria-label={copy.settings}
            title={copy.settings}
            onClick={() => settingsDialog.current?.showModal()}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <aside className="app-sidebar" aria-label={copy.navigation}>
        <div className="sidebar-actions">
          <CreateMenu
            copy={copy}
            parentId={selectedFolder}
            onCreate={(type, parentId) => void createDocument(type, parentId)}
            onFolder={startFolder}
          />
        </div>
        <button className="search-trigger" onClick={() => setSearchDialog(true)}>
          <Icon name="search" />
          <span>{copy.search}</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav className="sidebar-nav">
          <div className="sidebar-section-heading">
            <span>{copy.library}</span>
            <button
              className="quiet-icon-button"
              aria-label={copy.createFolder}
              onClick={() => startFolder(selectedFolder)}
            >
              <Icon name="plus" />
            </button>
          </div>
          <button
            className={`tree-row root-row ${selectedFolder === null && view === "library" ? "is-selected" : ""} ${dragOverId === "root" ? "drop-target" : ""}`}
            onClick={() => selectFolder(null)}
            onDragOver={(event) => {
              const item = [...folders, ...notes].find((entity) => entity.id === draggedId);
              if (item && canDrop(item, null)) {
                event.preventDefault();
                setDragOverId("root");
              }
            }}
            onDragLeave={() => setDragOverId(null)}
            onDrop={(event) => void dropItem(event, null)}
          >
            <Icon name="library" />
            <span className="tree-label">{copy.library}</span>
          </button>
          <div className="folder-tree" role="tree" aria-label={copy.tree}>
            {folderTree(null)}
          </div>
          <div className="sidebar-section-heading secondary-heading">
            <span>{copy.shortcuts}</span>
          </div>
          <button
            className={`tree-row root-row ${view === "trash" ? "is-selected" : ""}`}
            onClick={() => {
              setView("trash");
              setMobileNav(false);
            }}
          >
            <Icon name="trash" />
            <span className="tree-label">{copy.trash}</span>
            {trash.length > 0 && <span className="count-badge">{trash.length}</span>}
          </button>
          {notes.length > 0 && (
            <>
              <div className="sidebar-section-heading secondary-heading">
                <span>{copy.recent}</span>
              </div>
              {notes.slice(0, 5).map((note) => (
                <Link className="recent-link" key={note.id} href={`/notes/${note.id}`}>
                  <Icon name="note" />
                  <span>{note.title}</span>
                </Link>
              ))}
            </>
          )}
        </nav>
        <button className="sidebar-settings" onClick={() => settingsDialog.current?.showModal()}>
          <Icon name="settings" />
          {copy.settings}
        </button>
      </aside>
      {mobileNav && (
        <button className="mobile-scrim" aria-label={copy.closeNavigation} onClick={() => setMobileNav(false)} />
      )}

      <section className="library-workspace" aria-label={copy.library}>
        {conflicts.length > 0 && dismissedConflictKey !== conflictKey && (
          <aside className="conflict-banner" aria-label={copy.conflicts}>
            <span className="conflict-banner-icon" aria-hidden="true">
              <Icon name="warning" />
            </span>
            <div>
              <strong>{copy.conflictCount(conflicts.length)}</strong>
              <p>{copy.conflictBanner}</p>
            </div>
            <button className="primary-action" type="button" onClick={() => openConflictCenter()}>
              {copy.reviewConflicts}
            </button>
            <button
              className="quiet-icon-button"
              type="button"
              aria-label={copy.dismissConflictBanner}
              onClick={() => setDismissedConflictKey(conflictKey)}
            >
              <Icon name="close" />
            </button>
          </aside>
        )}
        <div className="workspace-heading">
          <div>
            <h1>
              {view === "search"
                ? copy.searchResults
                : view === "trash"
                  ? copy.trash
                  : (selected?.title ?? copy.library)}
            </h1>
            {(view === "search" || view === "trash" || selected) && (
              <p>
                {view === "search"
                  ? copy.searchScope
                  : view === "trash"
                    ? copy.trashDescription
                    : copy.folderDescription}
              </p>
            )}
          </div>
          <div className="workspace-actions">
            {view !== "trash" && (
              <label className="sort-control">
                {copy.sortBy}
                <select value={sortBy} onChange={(event) => changeSort(event.target.value as SortBy)}>
                  <option value="modified">{copy.lastModified}</option>
                  <option value="created">{copy.dateCreated}</option>
                  <option value="name">{copy.name}</option>
                </select>
              </label>
            )}
          </div>
        </div>
        {view === "search" && (
          <div className="search-scope">
            <Icon name="search" />
            <span>{copy.searchScope}</span>
            <button
              onClick={() => {
                setView("library");
                setQuery("");
              }}
            >
              {copy.clearSearch}
            </button>
          </div>
        )}
        {view === "trash" ? (
          <section className="item-list" aria-label={copy.trash}>
            {trash.length ? (
              sortItems(trash).map((item) => (
                <div className="content-row" key={item.id}>
                  <span className="content-open">
                    <Icon name={item.kind === "folder" ? "folder" : "note"} />
                    <span className="content-title">{item.title}</span>
                  </span>
                  <button className="secondary-action" onClick={() => void restore(item)}>
                    {copy.restore}
                  </button>
                </div>
              ))
            ) : (
              <EmptyState title={copy.trashEmpty} description={copy.trashEmptyHelp} />
            )}
          </section>
        ) : (
          <section className="item-list" aria-label={copy.items}>
            {view === "library" && filteredFolders(selectedFolder).map(folderRow)}
            {view === "library" && creatingParent === selectedFolder && (
              <InlineFolder
                value={folderName}
                inputRef={folderInput}
                copy={copy}
                onChange={setFolderName}
                onSave={() => void saveFolder()}
                onCancel={() => setCreatingParent(undefined)}
              />
            )}
            {visibleNotes.map(noteRow)}
            {view === "search" &&
              visibleFolders
                .filter((folder) => folder.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
                .map(folderRow)}
            {!visibleNotes.length &&
              !(view === "library" && filteredFolders(selectedFolder).length) &&
              !(
                view === "search" &&
                visibleFolders.some((folder) => folder.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
              ) && (
                <EmptyState
                  title={view === "search" ? copy.noMatches : copy.emptyTitle}
                  description={view === "search" ? copy.noMatchesHelp : copy.emptyHelp}
                />
              )}
          </section>
        )}
      </section>

      <dialog
        className="conflict-dialog"
        ref={conflictDialog}
        aria-labelledby="conflict-dialog-title"
        onClose={() => {
          setActiveConflict(null);
          setConflictBusy(false);
        }}
      >
        <div className="conflict-dialog-header">
          <div>
            <h2 id="conflict-dialog-title">{activeConflict ? activeConflict.local.title : copy.conflictCenter}</h2>
            <p>{copy.conflictReviewHelp}</p>
          </div>
          {activeConflict && (
            <button className="secondary-action" type="button" onClick={() => setActiveConflict(null)}>
              {copy.conflicts}
            </button>
          )}
          <button
            className="quiet-icon-button"
            type="button"
            aria-label={copy.close}
            onClick={() => conflictDialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        {activeConflict ? (
          <>
            <div className="conflict-metadata">
              <span className="document-type-icon" aria-hidden="true">
                <Icon
                  name={
                    activeConflict.local.kind === "folder"
                      ? "folder"
                      : activeConflict.local.type === "typst"
                        ? "typst"
                        : activeConflict.local.type === "whiteboard"
                          ? "board"
                          : "note"
                  }
                />
              </span>
              <span>
                {activeConflict.local.kind === "folder"
                  ? copy.folder
                  : activeConflict.local.type === "typst"
                    ? copy.typstType
                    : activeConflict.local.type === "whiteboard"
                      ? copy.whiteboardType
                      : copy.markdownType}
              </span>
              <span>
                {copy.conflictFolder}:{" "}
                {folderPathFor(
                  activeConflict.local.kind === "folder"
                    ? activeConflict.local.parentId
                    : activeConflict.local.folderId,
                )}
              </span>
            </div>
            <div className="conflict-versions">
              {(
                [
                  [copy.localVersion, activeConflict.local],
                  [copy.serverVersion, activeConflict.remote],
                ] as const
              ).map(([label, entity]) => (
                <section className="conflict-version" key={label}>
                  <h3>{label}</h3>
                  <p>
                    {copy.conflictFolder}: {folderPathFor(entity.kind === "folder" ? entity.parentId : entity.folderId)}
                  </p>
                  <p>
                    {copy.conflictModified}:{" "}
                    <time dateTime={new Date(entity.updatedAt).toISOString()}>
                      {new Date(entity.updatedAt).toLocaleString()}
                    </time>
                  </p>
                  {entity.revision && (
                    <p>
                      {copy.conflictRevisions}: {entity.revision}
                    </p>
                  )}
                  {entity.kind === "note" && entity.type !== "whiteboard" ? (
                    <pre>
                      {typeof entity.content === "string" ? entity.content : JSON.stringify(entity.content, null, 2)}
                    </pre>
                  ) : entity.kind === "note" ? (
                    <p className="dialog-note">{copy.conflictNoPreview}</p>
                  ) : (
                    <p className="dialog-note">{copy.conflictFolderUnsupported}</p>
                  )}
                </section>
              ))}
            </div>
            {activeConflict.local.kind === "note" &&
              activeConflict.local.type !== "whiteboard" &&
              activeConflict.remote.kind === "note" &&
              activeConflict.remote.type !== "whiteboard" && (
                <section className="conflict-diff" aria-label={copy.conflictDiff}>
                  <h3>{copy.conflictDiff}</h3>
                  {(() => {
                    const rows = compareTextVersions(
                      String(activeConflict.local.content ?? ""),
                      String(activeConflict.remote.content ?? ""),
                    );
                    return rows ? (
                      <pre>
                        {rows.map((row, index) => (
                          <span
                            className={`diff-${row.kind}`}
                            aria-label={
                              row.kind === "added"
                                ? copy.lineAdded
                                : row.kind === "removed"
                                  ? copy.lineRemoved
                                  : undefined
                            }
                            key={`${index}-${row.kind}`}
                          >
                            {row.kind === "added" ? "+ " : row.kind === "removed" ? "− " : "  "}
                            {row.text}
                            {"\n"}
                          </span>
                        ))}
                      </pre>
                    ) : (
                      <p>{copy.conflictDiffLarge}</p>
                    );
                  })()}
                </section>
              )}
            <section className="conflict-resolution-actions" aria-label={copy.conflicts}>
              <div>
                <button
                  className="primary-action"
                  type="button"
                  disabled={conflictBusy || activeConflict.local.kind !== "note"}
                  onClick={() => void chooseConflict(activeConflict, "copy")}
                >
                  {copy.keepBoth}
                </button>
                <p>{copy.keepBothHelp}</p>
              </div>
              <div>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={conflictBusy || activeConflict.local.kind !== "note"}
                  onClick={() => void chooseConflict(activeConflict, "remote")}
                >
                  {copy.keepServer}
                </button>
                <p>{copy.keepServerHelp}</p>
              </div>
              <div>
                <button
                  className="danger-action"
                  type="button"
                  disabled={conflictBusy}
                  onClick={() => void chooseConflict(activeConflict, "overwrite")}
                >
                  {copy.keepLocal}
                </button>
                <p>{copy.keepLocalHelp}</p>
              </div>
            </section>
          </>
        ) : (
          <div className="conflict-list">
            {conflicts.map((conflict) => (
              <article key={conflict.id}>
                <span className="document-type-icon" aria-hidden="true">
                  <Icon
                    name={
                      conflict.local.kind === "folder"
                        ? "folder"
                        : conflict.local.type === "typst"
                          ? "typst"
                          : conflict.local.type === "whiteboard"
                            ? "board"
                            : "note"
                    }
                  />
                </span>
                <div>
                  <strong>{conflict.local.title}</strong>
                  <p>
                    {conflict.local.kind === "folder"
                      ? copy.folder
                      : conflict.local.type === "typst"
                        ? copy.typstType
                        : conflict.local.type === "whiteboard"
                          ? copy.whiteboardType
                          : copy.markdownType}{" "}
                    ·{" "}
                    {folderPathFor(
                      conflict.local.kind === "folder" ? conflict.local.parentId : conflict.local.folderId,
                    )}
                  </p>
                  <small>
                    {copy.localVersion}: {new Date(conflict.local.updatedAt).toLocaleString()} · {copy.serverVersion}:{" "}
                    {new Date(conflict.remote.updatedAt).toLocaleString()}
                  </small>
                </div>
                <button className="primary-action" type="button" onClick={() => setActiveConflict(conflict)}>
                  {copy.reviewConflict}
                </button>
              </article>
            ))}
          </div>
        )}
      </dialog>

      <dialog
        ref={settingsDialog}
        className="app-dialog"
        onClick={(event) => {
          if (event.target === settingsDialog.current) settingsDialog.current?.close();
        }}
      >
        <div className="dialog-heading">
          <div>
            <h2>{copy.settings}</h2>
            <p>{copy.settingsDescription}</p>
          </div>
          <button className="icon-button" aria-label={copy.close} onClick={() => settingsDialog.current?.close()}>
            <Icon name="close" />
          </button>
        </div>
        <h3>{copy.account}</h3>
        <AuthPanel />
        <div className="settings-controls">
          <div>
            <strong>{common.theme}</strong>
            <span>{common.themeDescription}</span>
          </div>
          <LocaleSettingsControls />
        </div>
        <h3>{copy.serverSync}</h3>
        <p className="dialog-note">{copy.serverSyncDescription}</p>
        <p className="dialog-status">
          <span className="sync-dot" />
          {status}
        </p>
      </dialog>
      {searchDialog && (
        <dialog
          ref={quickSearchDialog}
          className="search-dialog"
          aria-labelledby="quick-search-title"
          onCancel={() => setSearchDialog(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSearchDialog(false);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSearchIndex((index) => Math.min(index + 1, quickMatches.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSearchIndex((index) => Math.max(index - 1, 0));
            }
            if (event.key === "Enter" && quickMatches[searchIndex])
              router.push(`/notes/${quickMatches[searchIndex].id}`);
          }}
        >
          <div className="quick-search-input">
            <Icon name="search" />
            <input
              id="quick-search-title"
              ref={searchInput}
              autoComplete="off"
              placeholder={copy.search}
              value={searchText}
              onChange={(event) => {
                setSearchText(event.target.value);
                setSearchIndex(0);
              }}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="quick-search-results" role="listbox" aria-label={copy.searchResults}>
            {quickMatches.length ? (
              quickMatches.map((note, index) => (
                <Link
                  role="option"
                  aria-selected={index === searchIndex}
                  className={index === searchIndex ? "is-active" : ""}
                  key={note.id}
                  href={`/notes/${note.id}`}
                  onClick={() => setSearchDialog(false)}
                >
                  <Icon name="note" />
                  <span>{note.title}</span>
                  <small>{note.type}</small>
                </Link>
              ))
            ) : (
              <p>{copy.noMatches}</p>
            )}
          </div>
          <footer>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> {copy.navigateResults}
            </span>
            <span>
              <kbd>↵</kbd> {copy.openResult}
            </span>
          </footer>
        </dialog>
      )}
      {movingItem && (
        <dialog
          ref={moveDialog}
          className="move-dialog"
          aria-labelledby="move-title"
          onCancel={() => setMovingItem(null)}
        >
          <h2 id="move-title">
            {copy.moveTo}: {movingItem.title}
          </h2>
          <label htmlFor="move-destination">{copy.destination}</label>
          <select
            id="move-destination"
            value={destinationId}
            onChange={(event) => setDestinationId(event.target.value)}
          >
            <option value="">{copy.root}</option>
            {validDestinations.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.title}
              </option>
            ))}
          </select>
          <div className="dialog-actions">
            <button className="secondary-action" onClick={() => setMovingItem(null)}>
              {copy.cancel}
            </button>
            <button className="primary-action" onClick={() => void confirmMove()}>
              {copy.confirmMove}
            </button>
          </div>
        </dialog>
      )}
    </main>
  );
}

function InlineFolder({
  value,
  inputRef,
  copy,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  copy: ReturnType<typeof useLocale>["library"];
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="inline-folder-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <Icon name="folder" />
      <input
        ref={inputRef}
        aria-label={copy.folderName}
        placeholder={copy.folderName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      <button type="submit" className="quiet-icon-button" aria-label={copy.createFolder}>
        <Icon name="check" />
      </button>
      <button type="button" className="quiet-icon-button" aria-label={copy.cancel} onClick={onCancel}>
        <Icon name="close" />
      </button>
    </form>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name="empty" />
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    warning: (
      <>
        <path d="m12 3 10 18H2L12 3Z" />
        <path d="M12 9v4m0 3h.01" />
      </>
    ),
    folder: (
      <>
        <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
        <path d="M3 9h18" />
      </>
    ),
    note: (
      <>
        <path d="M6 3.5h8l4 4v13H6z" />
        <path d="M14 3.5v4h4M9 12h6M9 15.5h6" />
      </>
    ),
    typst: (
      <>
        <path d="M5 4h14M12 4v16M8 20h8" />
        <path d="M7 8h10" />
      </>
    ),
    board: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="m7 15 3-4 3 2 4-5" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    folderPlus: (
      <>
        <path d="M3 7a1.5 1.5 0 0 1 1.5-1.5H9l2 2h8.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" />
        <path d="M12 11v6m-3-3h6" />
      </>
    ),
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r=".8" />
        <circle cx="12" cy="12" r=".8" />
        <circle cx="19" cy="12" r=".8" />
      </>
    ),
    right: <path d="m9 6 6 6-6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    library: (
      <>
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H20v15H5.5A1.5 1.5 0 0 1 4 17.5z" />
        <path d="M4 7h16M8 4v15" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4L7.3 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 2Z" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3" />
      </>
    ),
    menu: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </>
    ),
    panelLeft: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
      </>
    ),
    panelRight: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    empty: (
      <>
        <path d="M4 5h16v15H4z" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? null}
    </svg>
  );
}
