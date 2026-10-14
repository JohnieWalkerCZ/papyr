"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronRight,
  FileText,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Presentation,
  RefreshCw,
  Search,
  Settings,
  Sigma,
  Folder,
  Trash2,
} from "lucide-react";
import { createFolder, listLocalFolders, listLocalNotes, type LocalFolder, type LocalNote } from "@/lib/local-db";
import { createLocalDocument } from "@/lib/create-document";
import { useLocale, LocaleSettingsControls } from "@/lib/locale";
import { localConflicts, scheduleSync, syncLocalLibrary } from "@/lib/sync";
import { AuthPanel } from "./auth-panel";
import { CreateMenu } from "./document-creation-menu";

export function DocumentEditorShell({
  note,
  path,
  status,
  children,
}: {
  note: LocalNote;
  path: LocalFolder[];
  status: string;
  children: ReactNode;
}) {
  const copy = useLocale().library;
  const common = useLocale().common;
  const router = useRouter();
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [folders, setFolders] = useState<LocalFolder[]>([]);
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState("");
  const [settings, setSettings] = useState(false);
  const [syncStatus, setSyncStatus] = useState(status);
  const [syncState, setSyncState] = useState("");
  const [conflictCount, setConflictCount] = useState(0);
  const parentId = note.folderId;
  const visibleNotes = useMemo(
    () =>
      notes.filter((item) =>
        `${item.title}\n${typeof item.content === "string" ? item.content : ""}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
      ),
    [notes, search],
  );

  useEffect(() => {
    void Promise.all([listLocalFolders(), listLocalNotes()]).then(([allFolders, allNotes]) => {
      setFolders(allFolders);
      setNotes(allNotes);
      try {
        const saved = JSON.parse(localStorage.getItem("papyr-folder-expanded") || "[]") as string[];
        setExpanded([...new Set([...saved, ...path.map((folder) => folder.id)])]);
      } catch {
        setExpanded(path.map((folder) => folder.id));
      }
    });
    queueMicrotask(() => {
      try {
        setCollapsed(localStorage.getItem("papyr-sidebar-collapsed") === "true");
      } catch {
        // The editor shell stays expanded for this session.
      }
    });
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ state: string; message: string }>).detail;
      const labels: Record<string, string> = {
        syncing: copy.syncing,
        waiting: copy.syncWaiting,
        synced: copy.synced,
        offline: copy.offline,
        error: copy.syncError,
        conflict: copy.conflictStatus,
        authRequired: copy.authRequired,
      };
      setSyncState(detail.state);
      setSyncStatus(labels[detail.state] ?? detail.message);
      void localConflicts()
        .then((items) => setConflictCount(items.length))
        .catch(() => setConflictCount(0));
    };
    void localConflicts()
      .then((items) => setConflictCount(items.length))
      .catch(() => setConflictCount(0));
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("document-search")?.focus();
      }
    };
    window.addEventListener("papyr-sync-state", onSync);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("papyr-sync-state", onSync);
      window.removeEventListener("keydown", onKey);
    };
  }, [
    copy.authRequired,
    copy.conflictStatus,
    copy.offline,
    copy.syncError,
    copy.synced,
    copy.syncing,
    copy.syncWaiting,
    path,
  ]);
  useEffect(() => {
    const closePopovers = (event: PointerEvent) => {
      const path = event.composedPath();
      document
        .querySelectorAll<HTMLDetailsElement>("details.item-menu[open], details.sync-menu[open]")
        .forEach((menu) => {
          if (!path.includes(menu)) menu.removeAttribute("open");
        });
    };
    document.addEventListener("pointerdown", closePopovers, true);
    return () => document.removeEventListener("pointerdown", closePopovers, true);
  }, []);
  useEffect(() => {
    if (settings) settingsDialog.current?.showModal();
    else if (settingsDialog.current?.open) settingsDialog.current.close();
  }, [settings]);

  async function create(type: LocalNote["type"], folderId: string | null) {
    const title =
      type === "typst" ? copy.untitledTypst : type === "whiteboard" ? copy.untitledWhiteboard : copy.untitled;
    const created = await createLocalDocument(type, title, folderId);
    router.push(`/notes/${created.id}`);
  }

  async function newFolder(folderId: string | null) {
    const title = window.prompt(copy.folderName)?.trim();
    if (!title) return;
    await createFolder(title, folderId);
    scheduleSync();
    const [allFolders, allNotes] = await Promise.all([listLocalFolders(), listLocalNotes()]);
    setFolders(allFolders);
    setNotes(allNotes);
  }

  function toggleSidebar() {
    setCollapsed((value) => {
      try {
        localStorage.setItem("papyr-sidebar-collapsed", String(!value));
      } catch {
        // Keep the current preference for this session.
      }
      return !value;
    });
  }

  function folderTree(parentId: string | null, depth = 0): ReactNode {
    return folders
      .filter((folder) => folder.parentId === parentId)
      .map((folder) => (
        <div
          className="editor-folder-branch"
          key={folder.id}
          role="treeitem"
          aria-selected={folder.id === note.folderId}
          aria-expanded={expanded.includes(folder.id)}
        >
          <div
            className={`tree-row editor-folder-row ${folder.id === note.folderId ? "is-selected" : ""}`}
            title={folder.title}
            style={{ "--depth": depth } as React.CSSProperties}
          >
            <button
              className="tree-disclosure"
              aria-label={expanded.includes(folder.id) ? copy.collapse : copy.expand}
              aria-expanded={expanded.includes(folder.id)}
              onClick={() =>
                setExpanded((current) => {
                  const next = current.includes(folder.id)
                    ? current.filter((id) => id !== folder.id)
                    : [...current, folder.id];
                  try {
                    localStorage.setItem("papyr-folder-expanded", JSON.stringify(next));
                  } catch {
                    // Keep the folder tree usable for this session.
                  }
                  return next;
                })
              }
            >
              <ChevronRight
                aria-hidden="true"
                className={expanded.includes(folder.id) ? "is-expanded" : ""}
                size={14}
              />
            </button>
            <Link className="tree-open" href={`/?folder=${folder.id}`} onClick={() => setMobileNav(false)}>
              <Folder aria-hidden="true" size={16} />
              <span className="tree-label">{folder.title}</span>
            </Link>
          </div>
          {expanded.includes(folder.id) && <div role="group">{folderTree(folder.id, depth + 1)}</div>}
        </div>
      ));
  }

  return (
    <main className={`app-shell ${collapsed ? "sidebar-collapsed" : ""} ${mobileNav ? "mobile-nav-open" : ""}`}>
      <header className="app-header">
        <button
          className="icon-button mobile-menu-button"
          aria-label={copy.openNavigation}
          onClick={() => setMobileNav((open) => !open)}
        >
          <Menu aria-hidden="true" size={18} />
        </button>
        <Link className="app-brand" href="/">
          <span className="brand-mark">p</span>
          <span>Papyr</span>
        </Link>
        <button
          className="icon-button sidebar-toggle"
          aria-label={collapsed ? copy.expandSidebar : copy.collapseSidebar}
          onClick={toggleSidebar}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" size={18} /> : <PanelLeftClose aria-hidden="true" size={18} />}
        </button>
        <nav className="header-breadcrumbs" aria-label={copy.breadcrumb}>
          <Link href="/?folder=root">{copy.library}</Link>
          {path.map((folder) => (
            <span key={folder.id}>
              {" "}
              / <Link href={`/?folder=${folder.id}`}>{folder.title}</Link>
            </span>
          ))}
          <span> / {note.title}</span>
        </nav>
        <div className="header-actions">
          <details className="sync-menu">
            <summary
              className={`sync-indicator ${conflictCount ? "has-conflicts" : ""} ${syncState === "synced" || syncStatus === copy.synced ? "is-good" : syncState === "syncing" || syncStatus === copy.syncing ? "is-syncing" : syncState === "waiting" || syncState === "offline" || syncState === "authRequired" || syncStatus === copy.pendingSync || syncStatus === copy.offline || syncStatus === copy.authRequired ? "is-pending" : syncState === "error" || syncState === "conflict" || syncStatus === copy.syncError || syncStatus === copy.conflictStatus ? "is-error" : ""}`}
              aria-label={`${copy.syncStatus}: ${conflictCount ? copy.conflictCount(conflictCount) : syncStatus}`}
            >
              {conflictCount > 0 && <AlertTriangle aria-hidden="true" className="sync-warning" size={15} />}
              {!conflictCount && <span className="sync-dot" />}
              <span>{conflictCount ? copy.conflictCountShort(conflictCount) : syncStatus}</span>
            </summary>
            <div className="sync-popover">
              <strong>{copy.syncStatus}</strong>
              <p role="status">{syncStatus}</p>
              {conflictCount > 0 && (
                <Link className="conflict-review-link" href="/?view=conflicts">
                  {copy.reviewConflicts}
                </Link>
              )}
              <button type="button" onClick={() => void syncLocalLibrary()}>
                <RefreshCw aria-hidden="true" size={16} />
                {copy.syncNow}
              </button>
            </div>
          </details>
          <button
            className="icon-button"
            aria-label={copy.settings}
            title={copy.settings}
            onClick={() => setSettings(true)}
          >
            <Settings aria-hidden="true" size={18} />
          </button>
        </div>
      </header>
      <aside className="app-sidebar" aria-label={copy.navigation}>
        <div className="sidebar-actions">
          <CreateMenu
            copy={copy}
            parentId={parentId}
            onCreate={(type, folderId) => void create(type, folderId)}
            onFolder={(folderId) => void newFolder(folderId)}
          />
        </div>
        <label className="editor-search">
          <Search aria-hidden="true" size={16} />
          <input
            id="document-search"
            aria-label={copy.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={copy.search}
          />
          <kbd>⌘ K</kbd>
        </label>
        <nav className="sidebar-nav">
          <div className="sidebar-section-heading">
            <span>{copy.library}</span>
          </div>
          <Link className={`tree-row root-row ${note.folderId === null ? "is-selected" : ""}`} href="/?folder=root">
            <FileText aria-hidden="true" size={16} />
            {copy.library}
          </Link>
          <div className="folder-tree" role="tree" aria-label={copy.tree}>
            {folderTree(null)}
          </div>
          <div className="sidebar-section-heading secondary-heading">
            <span>{copy.shortcuts}</span>
          </div>
          <Link className="tree-row root-row" href="/?view=trash">
            <Trash2 aria-hidden="true" size={16} />
            <span>{copy.trash}</span>
          </Link>
          <div className="sidebar-section-heading secondary-heading">
            <span>{copy.recent}</span>
          </div>
          {visibleNotes.slice(0, 5).map((item) => (
            <Link className="recent-link" key={item.id} href={`/notes/${item.id}`}>
              {item.type === "typst" ? (
                <Sigma aria-hidden="true" size={16} />
              ) : item.type === "whiteboard" ? (
                <Presentation aria-hidden="true" size={16} />
              ) : (
                <FileText aria-hidden="true" size={16} />
              )}
              <span>{item.title}</span>
            </Link>
          ))}
        </nav>
        <button className="sidebar-settings" onClick={() => setSettings(true)}>
          <Settings aria-hidden="true" size={16} /> {copy.settings}
        </button>
      </aside>
      {mobileNav && (
        <button className="mobile-scrim" aria-label={copy.closeNavigation} onClick={() => setMobileNav(false)} />
      )}
      <section
        className={`document-workspace ${note.type === "whiteboard" ? "whiteboard-workspace" : ""}`}
        aria-label={note.title}
      >
        {children}
      </section>
      {settings && (
        <dialog
          ref={settingsDialog}
          className="app-dialog"
          onCancel={() => setSettings(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSettings(false);
          }}
        >
          <div className="dialog-heading">
            <div>
              <h2>{copy.settings}</h2>
              <p>{copy.settingsDescription}</p>
            </div>
            <button className="icon-button" aria-label={copy.close} onClick={() => setSettings(false)}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <h3>{copy.account}</h3>
          <AuthPanel />
          <div className="settings-controls">
            <strong>{common.theme}</strong>
            <LocaleSettingsControls />
          </div>
          <h3>{copy.serverSync}</h3>
          <p>{copy.serverSyncDescription}</p>
        </dialog>
      )}
    </main>
  );
}
