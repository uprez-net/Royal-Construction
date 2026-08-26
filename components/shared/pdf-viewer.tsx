"use client";

/**
 * Isolated react-pdf integration.
 *
 * pdfjs-dist touches browser-only globals (DOMMatrix, Path2D, etc.) as soon
 * as its module is evaluated — not just when it renders. In Next.js, "use
 * client" only marks a hydration boundary; the module is still executed on
 * the server during SSR of the client component tree, which is exactly what
 * crashes ("Object.defineProperty called on non-object").
 *
 * This file must NEVER be statically imported. It is only ever loaded from
 * file-preview-canvas.tsx via:
 *   dynamic(() => import("./pdf-viewer"), { ssr: false })
 * which tells Next.js to exclude it from the server bundle entirely.
 */

import * as React from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Skeleton } from "@/components/ui/skeleton";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export function PageSkeleton() {
  return <Skeleton className="h-[70vh] w-[54vh] max-w-full rounded-sm" />;
}

export interface PdfViewerProps {
  url: string;
  zoom: number;
  rotation: number;
  page: number;
  onDocLoad: (numPages: number) => void;
  onError: (message: string) => void;
}

export default function PdfViewer({ url, zoom, rotation, page, onDocLoad, onError }: PdfViewerProps) {
  return (
    <Document
      file={url}
      onLoadSuccess={(doc) => onDocLoad(doc.numPages)}
      onLoadError={() => onError("This PDF couldn't be loaded. It may be corrupted or blocked by CORS.")}
      loading={<PageSkeleton />}
      error={null}
      className="flex justify-center"
    >
      <Page
        pageNumber={page}
        scale={zoom}
        rotate={rotation}
        loading={<PageSkeleton />}
        className="overflow-hidden rounded-sm shadow-md ring-1 ring-border"
      />
    </Document>
  );
}