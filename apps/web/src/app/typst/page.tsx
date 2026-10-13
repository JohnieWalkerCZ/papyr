"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImagePlus } from "lucide-react";
import { useLocale } from "@/lib/locale";
import { localDb } from "@/lib/local-db";
import { SourceEditor } from "../source-editor";
import { PdfPreview } from "./PdfPreview";

const initialSourceValue = `#set text(font: "Libertinus Serif")
= Poznámky z matematiky

Český text a rovnice fungují offline.

$ integral_0^1 x^2 dif x = 1/3 $
`;

export default function TypstProof({
  initialSource = initialSourceValue,
  onSourceChange,
  onAddImage,
  embedded = false,
  readOnly = false,
}: {
  initialSource?: string;
  onSourceChange?: (source: string) => void;
  onAddImage?: () => void;
  embedded?: boolean;
  readOnly?: boolean;
}) {
  const locale = useLocale();
  const copy = locale.typst;
  const [localSource, setLocalSource] = useState(initialSource);
  const source = onSourceChange ? initialSource : localSource;
  const [status, setStatus] = useState<string>(copy.notStarted);
  const [compileError, setCompileError] = useState<{ location?: string; message: string; hints: string[] }[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string>();
  const [mobileView, setMobileView] = useState<"source" | "preview">("source");
  const [compiling, setCompiling] = useState(false);
  const running = useRef(false);
  const jobId = useRef(0);
  const activeCompiler = useRef<{ dispose: () => Promise<void> } | null>(null);

  useEffect(
    () => () => {
      jobId.current++;
      running.current = false;
      void activeCompiler.current?.dispose().catch(() => {});
    },
    [],
  );

  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );

  const compile = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setCompiling(true);
    const currentJob = ++jobId.current;
    setStatus(copy.starting);
    setCompileError([]);
    try {
      const [{ createTypstCompiler }, { createWebWorker }] = await Promise.all([
        import("typst-wasm"),
        import("typst-wasm/worker/browser"),
      ]);
      if (currentJob !== jobId.current) return;
      const base = "/typst/";
      const coreModules = Object.fromEntries(
        await Promise.all(
          ["engine.core.wasm", "engine.core2.wasm", "engine.core3.wasm"].map(async (name) => {
            const response = await fetch(`${base}${name}`);
            if (!response.ok) throw new Error(`Could not load ${name} (${response.status})`);
            return [name, await WebAssembly.compile(await response.arrayBuffer())];
          }),
        ),
      ) as Record<"engine.core.wasm" | "engine.core2.wasm" | "engine.core3.wasm", WebAssembly.Module>;
      if (currentJob !== jobId.current) return;
      const compiler = await createTypstCompiler({
        backend: "auto",
        worker: () => createWebWorker(`${base}web-worker.js`),
        coreModules,
        fetch: async () => {
          throw new Error("External Typst resources are disabled in this local editor.");
        },
      });
      activeCompiler.current = compiler;
      try {
        if (currentJob !== jobId.current) return;
        const fonts = [
          "LibertinusSerif-Regular.otf",
          "LibertinusSerif-Bold.otf",
          "LibertinusSerif-Italic.otf",
          "NewCMMath-Regular.otf",
        ];
        await compiler.addFonts(
          ...fonts.map(async (font) => new Uint8Array(await (await fetch(`${base}fonts/${font}`)).arrayBuffer())),
        );
        let compileSource = source;
        for (const uri of new Set(source.match(/papyr-asset:\/\/[0-9a-f-]{36}/gi) ?? [])) {
          const id = uri.slice("papyr-asset://".length);
          const asset = await localDb.assets.get(id);
          if (!asset) throw new Error(`Image ${id} is not available on this device.`);
          const extension = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[
            asset.mimeType
          ];
          const path = `asset-${id}.${extension}`;
          await compiler.addFile(path, new Uint8Array(await asset.blob.arrayBuffer()));
          compileSource = compileSource.replaceAll(uri, path);
        }
        await compiler.addSource("main.typ", compileSource);
        await compiler.setMain("main.typ");
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          compiler.compile({ format: "pdf" }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              void compiler.dispose().catch(() => {});
              reject(new Error("Compilation timed out after 120 seconds."));
            }, 120_000);
          }),
        ]).finally(() => {
          if (timeout) clearTimeout(timeout);
        });
        if (currentJob !== jobId.current) return;
        const pdfBytes = new ArrayBuffer(result.output.byteLength);
        new Uint8Array(pdfBytes).set(result.output);
        const nextUrl = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
        setPdfUrl(nextUrl);
        setStatus(copy.compiled);
      } finally {
        await compiler.dispose();
        if (activeCompiler.current === compiler) activeCompiler.current = null;
      }
    } catch (error) {
      if (currentJob !== jobId.current) return;
      const diagnostics = error && typeof error === "object" && "diagnostics" in error ? error.diagnostics : undefined;
      let items: unknown[] = Array.isArray(diagnostics) ? diagnostics : [];
      if (items.length === 0) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          const parsed: unknown = JSON.parse(message);
          items = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          items = [{ message }];
        }
      }
      setCompileError(
        items.map((item) => {
          const diagnostic = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          const file = typeof diagnostic.file === "string" ? diagnostic.file : undefined;
          const line = typeof diagnostic.line === "number" ? diagnostic.line : undefined;
          const column = typeof diagnostic.column === "number" ? diagnostic.column : undefined;
          const hints = Array.isArray(diagnostic.hints)
            ? diagnostic.hints.filter((hint): hint is string => typeof hint === "string")
            : [];
          return {
            location: file ? `${file}${line ? `:${line}${column ? `:${column}` : ""}` : ""}` : undefined,
            message:
              typeof diagnostic.message === "string"
                ? diagnostic.message
                : typeof diagnostic.formatted === "string"
                  ? diagnostic.formatted
                  : copy.failed,
            hints,
          };
        }),
      );
      setStatus(copy.failed);
    } finally {
      if (currentJob === jobId.current) {
        running.current = false;
        setCompiling(false);
      }
    }
  }, [copy.compiled, copy.failed, copy.starting, source]);

  useEffect(() => {
    const onSave = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void compile();
      }
    };
    window.addEventListener("keydown", onSave);
    return () => window.removeEventListener("keydown", onSave);
  }, [compile]);

  const editor = (
    <section className="typst-editor">
      {!embedded && (
        <>
          <div className="prototype-header">
            <Link href="/">{locale.common.back}</Link>
          </div>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </>
      )}
      <div className="type-editor-toolbar">
        <button className="primary-action" onClick={() => void compile()} disabled={compiling}>
          {copy.compile}
        </button>
        {onAddImage && (
          <button className="secondary-action" type="button" onClick={onAddImage} disabled={readOnly}>
            <ImagePlus aria-hidden="true" size={16} />
            {locale.library.attachImage}
          </button>
        )}
        {pdfUrl && (
          <a className="secondary-action" href={pdfUrl} download="document.pdf">
            {copy.exportPdf}
          </a>
        )}
        <p role="status" aria-live="polite">
          {status}
        </p>
      </div>
      {compileError.length > 0 && (
        <details className="compile-error">
          <summary role="alert" aria-label={copy.failed}>
            <strong>{copy.failed}</strong>
            <span>
              {compileError[0].location ? `${compileError[0].location} · ` : ""}
              {compileError[0].message}
              {compileError[0].hints[0] ? ` · ${compileError[0].hints[0]}` : ""}
            </span>
          </summary>
          <div className="compile-error-details">
            {compileError.map((diagnostic, index) => (
              <div className="compile-diagnostic" key={`${diagnostic.location ?? "error"}-${index}`}>
                {diagnostic.location && <code>{diagnostic.location}</code>}
                <p>{diagnostic.message}</p>
                {diagnostic.hints.length > 0 && (
                  <ul>
                    {diagnostic.hints.map((hint) => (
                      <li key={hint}>{hint}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="responsive-toggle" role="group" aria-label={copy.switchView}>
        <button
          type="button"
          className="button"
          aria-pressed={mobileView === "source"}
          onClick={() => setMobileView("source")}
        >
          {copy.source}
        </button>
        <button
          type="button"
          className="button"
          aria-pressed={mobileView === "preview"}
          onClick={() => setMobileView("preview")}
        >
          {copy.preview}
        </button>
      </div>
      <div className="typst-grid" data-mobile-view={mobileView}>
        <div className="typst-panel typst-source-panel">
          <h2>{copy.source}</h2>
          <SourceEditor
            label={copy.source}
            type="typst"
            value={source}
            readOnly={readOnly}
            onChange={(value) => {
              setLocalSource(value);
              onSourceChange?.(value);
            }}
          />
        </div>
        <section className="typst-panel preview" aria-label={copy.pdfOutput}>
          <h2>{copy.pdfOutput}</h2>
          <div className="typst-preview-content">
            {pdfUrl ? (
              <>
                {compileError.length > 0 && <span className="stale-preview">{copy.stalePreview}</span>}
                <PdfPreview title={copy.pdfOutput} url={pdfUrl} />
              </>
            ) : (
              <p>{copy.emptyPreview}</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
  return embedded ? editor : <main className="prototype-page">{editor}</main>;
}
