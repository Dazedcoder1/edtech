import React, { useEffect, useRef, useState } from 'react';
import { Loader } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
/*
 * ?worker, not ?url.
 *
 * ?url emits the worker as a .mjs asset and lets the browser fetch it as a
 * module script. That requires the web server to send .mjs as JavaScript —
 * many send application/octet-stream, and Chrome then refuses it outright
 * ("Strict MIME type checking is enforced for module scripts"). pdf.js falls
 * back to a "fake worker", which then fails too, and nothing renders.
 *
 * ?worker makes Vite bundle it into an ordinary .js chunk and hands us a
 * Worker constructor, so the MIME type of .mjs stops mattering.
 */
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

// workerPort takes a live Worker; workerSrc takes a URL. Using the port avoids
// the fetch entirely.
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

/**
 * Render a PDF to canvases instead of handing it to the browser.
 *
 * An <iframe> only shows a document on platforms with a built-in PDF viewer.
 * Desktop Chrome has one; Android Chrome does not, and instead shows a stub
 * with the blob's UUID and an "Open" button — so the same code looked fine on a
 * laptop and broken on a phone, which is exactly where students read.
 *
 * Drawing the pages ourselves removes that dependency: identical output on
 * every device, and no native toolbar offering print or download.
 *
 * @param {ArrayBuffer} data raw PDF bytes
 */
export default function PdfCanvasViewer({ data, title }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    if (!data) return;

    let cancelled = false;
    let doc = null;

    const render = async () => {
      setStatus('loading');
      try {
        // pdf.js takes ownership of the buffer it is given and detaches it, so
        // a copy is passed — otherwise re-opening the same document throws
        // "Cannot perform Construct on a detached ArrayBuffer".
        doc = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;
        if (cancelled) return;

        setPageCount(doc.numPages);

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';

        const available = container.clientWidth || 800;

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;

          const unscaled = page.getViewport({ scale: 1 });

          // Render above CSS size so text stays sharp on high-density screens,
          // but cap it — a 4x canvas of a large page exhausts mobile memory.
          const fit = available / unscaled.width;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: fit * dpr });

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className =
            'block w-full mb-3 rounded-lg border-2 border-black bg-white shadow-[2px_2px_0px_0px_#111]';
          container.appendChild(canvas);

          await page.render({
            canvasContext: canvas.getContext('2d'),
            viewport,
          }).promise;

          if (cancelled) return;

          // Show the first page as soon as it exists rather than waiting for a
          // 200-page document to finish.
          if (n === 1) setStatus('ready');
        }

        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('[PdfCanvasViewer]', err);
        setError(err?.message || 'Could not display this PDF.');
        setStatus('error');
      }
    };

    render();

    return () => {
      cancelled = true;
      doc?.destroy?.();
    };
  }, [data]);

  return (
    <div className="w-full h-full overflow-y-auto bg-[#F4F4F4] p-2 md:p-4">
      {status === 'loading' && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 font-bold text-gray-500">
          <Loader className="animate-spin text-[#F26B4D]" size={28} strokeWidth={3} />
          Rendering {title || 'document'}...
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 px-6 text-center">
          <p className="font-bold text-red-600">Could not display this PDF.</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      )}

      <div ref={containerRef} />

      {status === 'ready' && pageCount > 1 && (
        <p className="text-center text-xs font-bold text-gray-500 py-2">
          {pageCount} pages
        </p>
      )}
    </div>
  );
}
