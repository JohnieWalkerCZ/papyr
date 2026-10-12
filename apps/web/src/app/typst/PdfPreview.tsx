"use client";

import { useEffect, useRef } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export function PdfPreview({ url, title }: { url: string; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

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
          const viewport = page.getViewport({ scale: container.clientWidth / baseViewport.width });
          const pixelRatio = window.devicePixelRatio || 1;
          const canvas = document.createElement("canvas");
          canvas.setAttribute("aria-label", `${title} ${pageNumber}`);
          canvas.width = Math.ceil(viewport.width * pixelRatio);
          canvas.height = Math.ceil(viewport.height * pixelRatio);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          canvas.style.maxWidth = "100%";
          canvases.push(canvas);
          const renderTask = page.render({
            canvas,
            viewport,
            transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
          });
          renderTasks.push(renderTask);
          await renderTask.promise;
        }
        if (!cancelled && version === renderVersion) container.replaceChildren(...canvases);
      } catch {
        pdfPromise = undefined;
        if (!cancelled && version === renderVersion) container.textContent = "PDF preview could not be rendered.";
      }
    };

    const observer = new ResizeObserver(() => void render());
    observer.observe(container);
    void render();
    return () => {
      cancelled = true;
      observer.disconnect();
      renderTasks.forEach((task) => task.cancel());
      void loadingTask?.destroy();
    };
  }, [title, url]);

  return <div className="typst-pdf-pages" ref={containerRef} role="img" aria-label={title} />;
}
