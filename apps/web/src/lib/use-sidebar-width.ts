"use client";

import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
const STORAGE_KEY = "papyr-sidebar-width";

export function useSidebarWidth() {
  const [width, setWidth] = useState(272);
  const widthRef = useRef(272);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if (saved >= MIN_WIDTH && saved <= MAX_WIDTH)
        queueMicrotask(() => {
          widthRef.current = saved;
          setWidth(saved);
        });
    } catch {
      // Keep the default width for this session.
    }
  }, []);

  function persist(next: number) {
    const bounded = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
    widthRef.current = bounded;
    setWidth(bounded);
    try {
      localStorage.setItem(STORAGE_KEY, String(bounded));
    } catch {
      // Keep the selected width for this page session.
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: widthRef.current };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    persist(dragRef.current.startWidth + event.clientX - dragRef.current.startX);
  }

  function onPointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      localStorage.setItem(STORAGE_KEY, String(widthRef.current));
    } catch {
      // Keep the selected width for this page session.
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    persist(
      event.key === "Home"
        ? MIN_WIDTH
        : event.key === "End"
          ? MAX_WIDTH
          : width + (event.key === "ArrowRight" ? 16 : -16),
    );
  }

  return { width, onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}
