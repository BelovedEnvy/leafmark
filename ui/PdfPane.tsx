"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Minus, Plus, RotateCcw } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

export type Citation = {
  id: number;
  page: number;
  chunk_id: string;
  verbatim_quote: string;
  boxes: [number, number, number, number][];
};

export type Selection = { citation: Citation; revision: number };

export default function PdfPane({
  url,
  name,
  selection,
  refreshLink,
}: {
  url: string;
  name: string;
  selection: Selection | null;
  refreshLink: () => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState(0);
  const [ratio, setRatio] = useState(0.743);
  const [pageText, setPageText] = useState("");
  const [painted, setPainted] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const firstMark = useRef<HTMLSpanElement>(null);
  const citation = selection?.citation;

  useEffect(() => {
    let cancelled = false;
    let loading: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    setPdf(null);
    setError("");
    setPainted(false);
    setPageNumber(1);
    setZoom(1);
    void (async () => {
      const engine = await import("pdfjs-dist");
      if (cancelled) return;
      engine.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      loading = engine.getDocument({ url, useSystemFonts: true });
      const document = await loading.promise;
      if (!cancelled) setPdf(document);
    })().catch(() => {
      if (!cancelled) setError("The PDF could not be opened. Reopen the document to refresh its link.");
    });
    return () => {
      cancelled = true;
      void loading?.destroy().catch(() => undefined);
    };
  }, [url, retry]);

  useEffect(() => {
    if (!paper.current) return;
    const observer = new ResizeObserver(([entry]) => setSize(Math.round(entry.contentRect.width)));
    observer.observe(paper.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (selection) setPageNumber(selection.citation.page);
  }, [selection]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0, left: 0 });
  }, [pageNumber, url]);

  useEffect(() => {
    if (!pdf || !size || !canvas.current) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    const surface = canvas.current;
    setPainted(false);
    setPageText("");
    void (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const original = page.getViewport({ scale: 1 });
      const scale = (size / original.width) * Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale });
      setRatio(original.width / original.height);
      surface.width = Math.ceil(viewport.width);
      surface.height = Math.ceil(viewport.height);
      task = page.render({ canvas: surface, viewport });
      await task.promise;
      if (!cancelled) {
        setPainted(true);
        setError("");
      }
      const text = await page.getTextContent();
      if (!cancelled) setPageText(text.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    })().catch(() => {
      if (!cancelled) setError("This page could not be rendered. Open the PDF to read it.");
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, size]);

  useEffect(() => {
    const view = scroll.current;
    const mark = firstMark.current;
    if (!mark || !view || !painted || citation?.page !== pageNumber) return;
    const top = mark.getBoundingClientRect().top - view.getBoundingClientRect().top;
    if (top < 16 || top > view.clientHeight * 0.8) {
      view.scrollTop += top - view.clientHeight * 0.35;
    }
  }, [selection, citation, painted, pageNumber]);

  return (
    <div className="pdf-pane">
      <div className="pdf-controls">
        <div className="control-group">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous page"
            disabled={!pdf || pageNumber <= 1}
            onClick={() => setPageNumber((p) => p - 1)}
          >
            <ChevronLeft />
          </button>
          <span aria-live="polite" className="page-count">
            Page <b>{pageNumber}</b> / {pdf?.numPages ?? "…"}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Next page"
            disabled={!pdf || pageNumber >= pdf.numPages}
            onClick={() => setPageNumber((p) => p + 1)}
          >
            <ChevronRight />
          </button>
        </div>
        <div className="control-group">
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom out"
            disabled={zoom <= 0.75}
            onClick={() => setZoom((z) => z - 0.25)}
          >
            <Minus />
          </button>
          <button type="button" className="zoom-value" title="Reset zoom" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom in"
            disabled={zoom >= 2}
            onClick={() => setZoom((z) => z + 0.25)}
          >
            <Plus />
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="icon-button open-pdf"
            aria-label="Open original PDF in a new tab"
          >
            <ExternalLink />
          </a>
        </div>
      </div>
      <div className="pdf-scroll" ref={scroll} tabIndex={0} aria-label="PDF page viewer">
        {error && (
          <p className="viewer-status" role="alert">
            {error}{" "}
            <button
              type="button"
              className="plain-button"
              onClick={() => {
                refreshLink();
                setRetry((count) => count + 1);
              }}
            >
              Reopen document
            </button>
          </p>
        )}
        {!pdf && !error && (
          <p className="viewer-status" role="status">
            Opening PDF…
          </p>
        )}
        <div className="paper" ref={paper} style={{ width: `${zoom * 100}%`, aspectRatio: ratio }}>
          <canvas ref={canvas} role="img" aria-label={`${name}, page ${pageNumber}`} />
          <p className="sr-only">{pageText}</p>
          {painted && citation?.page === pageNumber && (
            <div key={selection?.revision} className="mark-layer" aria-hidden="true">
              {citation.boxes.map(([x, y, w, h], i) => (
                <span
                  key={i}
                  ref={i === 0 ? firstMark : undefined}
                  className="quote-mark"
                  style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    width: `${w * 100}%`,
                    height: `${h * 100}%`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {citation && (
        <div className="passage-status">
          <span className="passage-dot" aria-hidden="true" />
          <span>
            Source [{citation.id}] · Page {citation.page}
          </span>
          {pageNumber !== citation.page && (
            <button type="button" className="plain-button" onClick={() => setPageNumber(citation.page)}>
              <RotateCcw /> Return to passage
            </button>
          )}
        </div>
      )}
    </div>
  );
}
