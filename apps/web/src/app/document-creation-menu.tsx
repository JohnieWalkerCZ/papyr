"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileText, FolderPlus, Plus, Presentation, Sigma } from "lucide-react";
import type { LocalNote } from "@/lib/local-db";
import type { useLocale } from "@/lib/locale";

type LibraryCopy = ReturnType<typeof useLocale>["library"];
type CreateCopy = Pick<
  LibraryCopy,
  | "createNote"
  | "createTypstNote"
  | "createWhiteboardNote"
  | "markdownDescription"
  | "typstDescription"
  | "whiteboardDescription"
>;

const choices: { type: LocalNote["type"]; title: keyof CreateCopy; detail: keyof CreateCopy; Icon: typeof FileText }[] =
  [
    { type: "markdown", title: "createNote", detail: "markdownDescription", Icon: FileText },
    { type: "typst", title: "createTypstNote", detail: "typstDescription", Icon: Sigma },
    { type: "whiteboard", title: "createWhiteboardNote", detail: "whiteboardDescription", Icon: Presentation },
  ];

export function CreateMenu({
  copy,
  parentId,
  onCreate,
  onFolder,
}: {
  copy: LibraryCopy;
  parentId: string | null;
  onCreate: (type: LocalNote["type"], parentId: string | null) => void;
  onFolder: (parentId: string | null) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const focusOnOpen = useRef<"first" | "last" | null>(null);
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    const actions = menu.current?.querySelectorAll<HTMLButtonElement>(".create-option");
    actions?.[focusOnOpen.current === "first" ? 0 : actions.length - 1]?.focus();
    focusOnOpen.current = null;
  }, [open]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <div
      className={`create-menu unified-create-menu ${open ? "is-open" : ""}`}
      ref={menu}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          event.currentTarget.querySelector("button")?.focus();
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
          const actions = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".create-option"));
          event.preventDefault();
          if (!actions.length) {
            focusOnOpen.current = event.key === "ArrowUp" || event.key === "End" ? "last" : "first";
            setOpen(true);
            return;
          }
          const current = actions.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? actions.length - 1
                : current < 0
                  ? event.key === "ArrowDown"
                    ? 0
                    : actions.length - 1
                  : (current + (event.key === "ArrowDown" ? 1 : -1) + actions.length) % actions.length;
          actions[next].focus();
        }
      }}
    >
      <button
        className="new-button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus aria-hidden="true" size={18} />
        <span>{copy.new}</span>
      </button>
      {open && (
        <div className="create-menu-popover" id={menuId} role="group" aria-label={copy.new}>
          <CreateActions copy={copy} parentId={parentId} onCreate={onCreate} onAction={() => setOpen(false)} />
          <div className="create-menu-divider" />
          <button
            type="button"
            className="create-option"
            onClick={() => {
              setOpen(false);
              onFolder(parentId);
            }}
          >
            <FolderPlus aria-hidden="true" size={18} />
            <span>
              <strong>{copy.createFolder}</strong>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export function CreateActions({
  copy,
  parentId,
  onCreate,
  onAction,
}: {
  copy: CreateCopy;
  parentId: string | null;
  onCreate: (type: LocalNote["type"], parentId: string | null) => void;
  onAction?: () => void;
}) {
  return choices.map((choice) => (
    <button
      type="button"
      className="create-option"
      key={choice.type}
      onClick={() => {
        onCreate(choice.type, parentId);
        onAction?.();
      }}
    >
      <choice.Icon aria-hidden="true" size={18} />
      <span>
        <strong>{copy[choice.title]}</strong>
        <small>{copy[choice.detail]}</small>
      </span>
    </button>
  ));
}
