"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export function PdfPreview({
  url,
  title,
  controls,
}: {
  url: string;
  title: string;
  controls: { zoomIn: string; zoomOut: string; resetZoom: string; fitWidth: string; fitPage: string };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const zoomAnchor = useRef<{ zoom: number; x: number; y: number; left: number; top: number } | undefined>(undefined);
  const pinchStart = useRef<{ distance: number; zoom: number } | undefined>(undefined);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<"width" | "page">("width");
  const zoomRef = useRef(zoom);
  const fitModeRef = useRef(fitMode);

  const zoomAt = useCallback(
    (nextZoom: number, x?: number, y?: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      zoomAnchor.current = {
        zoom,
        x: x ?? rect.width / 2,
        y: y ?? rect.height / 2,
        left: container.scrollLeft,
        top: container.scrollTop,
      };
      setZoom(nextZoom);
    },
    [zoom],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let renderTasks: { cancel: () => void; promise: Promise<void> }[] = [];
    let loadingTask: ReturnType<typeof getDocument> | undefined;
    let pdfPromise: Promise<Awaited<ReturnType<typeof getDocument>["promise"]>> | undefined;
    let renderVersion = 0;

    const render = async () => {
      const version = ++renderVersion;
      renderTasks.forEach((task) => task.cancel());
      renderTasks = [];
      if (!container.clientWidth) return;
      try {
        pdfPromise ??= (async () => {
          const response = await fetch(url);
          if (!response.ok) throw new Error("Could not load the PDF preview.");
          loadingTask = getDocument({ data: await response.arrayBuffer() });
          return loadingTask.promise;
        })();
        const pdfDocument = await pdfPromise;
        if (cancelled || version !== renderVersion) return;
        const canvases: HTMLCanvasElement[] = [];
        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
          const page = await pdfDocument.getPage(pageNumber);
          if (cancelled || version !== renderVersion) return;
          const baseViewport = page.getViewport({ scale: 1 });
          const styles = getComputedStyle(container);
          const availableWidth =
            container.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight);
          const availableHeight =
            container.clientHeight - Number.parseFloat(styles.paddingTop) - Number.parseFloat(styles.paddingBottom);
          const fitScale =
            fitModeRef.current === "page"
              ? Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height)
              : availableWidth / baseViewport.width;
          const viewport = page.getViewport({ scale: fitScale * zoomRef.current });
          const pixelRatio = window.devicePixelRatio || 1;
          const canvas = document.createElement("canvas");
          canvas.setAttribute("aria-label", `${title} ${pageNumber}`);
          canvas.width = Math.ceil(viewport.width * pixelRatio);
          canvas.height = Math.ceil(viewport.height * pixelRatio);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          canvas.style.maxWidth = "none";
          canvases.push(canvas);
          const renderTask = page.render({
            canvas,
            viewport,
            transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
          });
          renderTasks.push(renderTask);
          await renderTask.promise;
        }
        if (!cancelled && version === renderVersion) {
          container.replaceChildren(...canvases);
          const anchor = zoomAnchor.current;
          if (anchor) {
            const ratio = zoomRef.current / anchor.zoom;
            container.scrollLeft = (anchor.left + anchor.x) * ratio - anchor.x;
            container.scrollTop = (anchor.top + anchor.y) * ratio - anchor.y;
            zoomAnchor.current = undefined;
          }
        }
      } catch {
        pdfPromise = undefined;
        if (!cancelled && version === renderVersion) container.textContent = "PDF preview could not be rendered.";
      }
    };

    renderRef.current = render;
    const observer = new ResizeObserver(() => void render());
    observer.observe(container);
    void render();
    return () => {
      cancelled = true;
      renderRef.current = undefined;
      observer.disconnect();
      renderTasks.forEach((task) => task.cancel());
      void loadingTask?.destroy();
    };
  }, [title, url]);

  useEffect(() => {
    zoomRef.current = zoom;
    fitModeRef.current = fitMode;
    void renderRef.current?.();
  }, [fitMode, zoom]);

  function fit(mode: "width" | "page") {
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
      containerRef.current.scrollTop = 0;
    }
    setFitMode(mode);
    setZoom(1);
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = container.getBoundingClientRect();
      zoomAt(
        Math.min(3, Math.max(0.5, zoomRef.current * Math.exp(-event.deltaY * 0.01))),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const [first, second] = Array.from(event.touches);
      pinchStart.current = {
        distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
        zoom: zoomRef.current,
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinchStart.current) return;
      event.preventDefault();
      event.stopPropagation();
      const [first, second] = Array.from(event.touches);
      const rect = container.getBoundingClientRect();
      const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
      zoomAt(
        Math.min(3, Math.max(0.5, pinchStart.current.zoom * (distance / pinchStart.current.distance))),
        (first.clientX + second.clientX) / 2 - rect.left,
        (first.clientY + second.clientY) / 2 - rect.top,
      );
    };
    const endPinch = () => {
      pinchStart.current = undefined;
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", endPinch);
    container.addEventListener("touchcancel", endPinch);
    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", endPinch);
      container.removeEventListener("touchcancel", endPinch);
    };
  }, [zoomAt]);

  return (
    <>
      <div className="typst-pdf-controls" role="group" aria-label={title}>
        <button
          type="button"
          className="button fit-control"
          aria-label={controls.fitWidth}
          aria-pressed={fitMode === "width"}
          onClick={() => fit("width")}
        >
          {controls.fitWidth}
        </button>
        <button
          type="button"
          className="button fit-control"
          aria-label={controls.fitPage}
          aria-pressed={fitMode === "page"}
          onClick={() => fit("page")}
        >
          {controls.fitPage}
        </button>
        <button
          type="button"
          className="button"
          aria-label={controls.zoomOut}
          disabled={zoom <= 0.5}
          onClick={() => zoomAt(Math.max(0.5, zoom - 0.25))}
        >
          −
        </button>
        <button
          type="button"
          className="button zoom-level"
          aria-label={controls.resetZoom}
          onClick={() => fit("width")}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="button"
          aria-label={controls.zoomIn}
          disabled={zoom >= 3}
          onClick={() => zoomAt(Math.min(3, zoom + 0.25))}
        >
          +
        </button>
      </div>
      <div className="typst-pdf-pages" ref={containerRef} aria-label={title} />
    </>
  );
}
