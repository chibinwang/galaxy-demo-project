import { Loader2 } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';
import type { DrawingRevision } from '../../shared/eng';
import { PREVIEWABLE } from '../../shared/eng';
import { fileUrl } from './data';
import { MockCadPreview } from './MockCadPreview';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type Zoom = 'fit' | number;

/** Renders one page of a real PDF to a canvas with pdf.js (crisp at any zoom / device pixel ratio). */
function PdfCanvas({ url, page, zoom, width, onPages }: { url: string; page: number; zoom: Zoom; width: number; onPages: (n: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    const task = pdfjs.getDocument({ url });
    task.promise.then(
      (d) => {
        if (cancelled) return;
        setDoc(d);
        onPages(d.numPages);
      },
      (e) => !cancelled && setError(String(e?.message ?? e)),
    );
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!doc || !canvas.current || width <= 0) return;
    let task: pdfjs.RenderTask | null = null;
    let cancelled = false;
    doc.getPage(Math.min(page, doc.numPages)).then((p) => {
      if (cancelled || !canvas.current) return;
      const base = p.getViewport({ scale: 1 });
      const scale = zoom === 'fit' ? (width - 32) / base.width : zoom;
      const vp = p.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const c = canvas.current;
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      c.style.width = `${Math.floor(vp.width)}px`;
      c.style.height = `${Math.floor(vp.height)}px`;
      task = p.render({ canvas: c, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, zoom, width]);

  if (error) return <div className="p-8 text-sm text-red-700">Could not render this PDF: {error}</div>;
  return (
    <div className="relative">
      {!doc && (
        <div className="flex h-64 items-center justify-center text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      <canvas ref={canvas} className="mx-auto block bg-white shadow-[0_2px_12px_rgba(15,23,42,0.12)]" aria-label="PDF page" />
    </div>
  );
}

/** Preview of the actual uploaded file — never a stand-in illustration. */
export function DocumentPreview({ rev, page, zoom, width, onPages }: { rev: DrawingRevision; page: number; zoom: Zoom; width: number; onPages: (n: number) => void }) {
  if (!rev.fileId) return <div className="p-8 text-sm text-slate-500">No file attached to this revision.</div>;
  const url = fileUrl(rev.fileId);
  if (rev.format === 'pdf') return <PdfCanvas url={url} page={page} zoom={zoom} width={width} onPages={onPages} />;
  if (PREVIEWABLE(rev.format)) {
    const w = zoom === 'fit' ? width - 32 : Math.round(842 * zoom);
    return <img src={url} alt={rev.fileName} className="mx-auto block max-w-none bg-white shadow-[0_2px_12px_rgba(15,23,42,0.12)]" style={{ width: w }} draggable={false} />;
  }
  // CAD formats can't be rendered in the browser: show the labelled illustrative mock sheet instead.
  return <MockCadPreview rev={rev} width={width} zoom={zoom} />;
}
