"use client";

/**
 * <FilePreviewCanvas url="https://example.com/path/to/file.pdf" />
 *
 * A single-prop file preview modal for PDF, DOCX and XLSX documents.
 * The file type is detected from the URL's extension, fetched, and
 * rendered natively in the browser (no external viewer / iframe embed).
 *
 * ── Setup ──────────────────────────────────────────────────────────────
 * 1. shadcn components (run once):
 *    npx shadcn@latest add dialog button tooltip scroll-area skeleton badge tabs separator
 *
 * 2. Rendering engines:
 *    npm install react-pdf docx-preview exceljs
 *
 * 3. Requires the companion file `pdf-viewer.tsx` in the same folder. The
 *    PDF engine (pdfjs-dist) touches browser-only globals as soon as its
 *    module is evaluated, which crashes Next.js SSR — even inside a
 *    "use client" file, since Next still executes client components on the
 *    server for the initial HTML. Keeping it in its own file and loading it
 *    via `dynamic(() => import("./pdf-viewer"), { ssr: false })` excludes
 *    it from the server bundle entirely. Don't import react-pdf statically
 *    anywhere else in the app for the same reason.
 *
 * 4. Next.js users only — silence the pdf.js "canvas" warning by adding to
 *    next.config.js:
 *      webpack: (config) => { config.resolve.alias.canvas = false; return config; }
 *
 * 5. KNOWN ISSUE — Next.js 16 dev server + pdfjs-dist 5.4.x:
 *    "TypeError: Object.defineProperty called on non-object" thrown from
 *    pdf.mjs on load. This is an open upstream bug (mozilla/pdf.js#20478,
 *    wojtekmaj/react-pdf#2031) caused by Next's eval-based dev `devtool`
 *    colliding with pdf.js's generated module wrapper. Not caused by this
 *    component. Fix in next.config.js, then `rm -rf .next` and restart:
 *      webpack: (config, { dev }) => {
 *        if (dev) config.devtool = "source-map";
 *        config.resolve.alias.canvas = false;
 *        return config;
 *      }
 *    If it persists, pin a known-good build in package.json:
 *      "pnpm": { "overrides": { "pdfjs-dist": "5.4.394" } }
 *    (or "overrides"/"resolutions" at the root for npm/yarn), then reinstall.
 *
 * Notes:
 * - The target URL must be reachable via fetch/XHR from the browser
 *   (same-origin, or CORS-enabled with GET + Range support for PDFs).
 * - This file ships its own blurred dialog chrome (built on
 *   @radix-ui/react-dialog, the same primitive shadcn's Dialog wraps) so it
 *   drops in without editing your generated components/ui/dialog.tsx.
 * - DRIVEN FROM REDUX / A MODAL MANAGER? Pass `onClose` and dispatch your
 *   close action from it, so the store actually stops rendering this
 *   component instead of leaving the same instance mounted with its
 *   internal "open" state stuck at false:
 *     case "previewFile": {
 *       const { fileUrl } = modal.payload as { fileUrl: string };
 *       return (
 *         <FilePreviewCanvas
 *           key={fileUrl}                          // extra safety net
 *           url={fileUrl}
 *           onClose={() => dispatch(closeModal())} // <- required
 *         />
 *       );
 *     }
 *   Without `onClose`, the ✕ button / Escape / backdrop click only hide the
 *   dialog locally — your store never learns it closed, so re-dispatching
 *   "open" reuses the same already-closed instance and nothing appears.
 * ──────────────────────────────────────────────────────────────────────
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { Dialog as DialogPrimitive } from "radix-ui";
import { renderAsync } from "docx-preview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SheetMerge } from "@/lib/spreadsheet/workbook-grid";
import { readWorkbookGrid } from "@/lib/spreadsheet/workbook-grid";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  FileWarning,
  Loader2,
  Maximize2,
  Minimize2,
  Printer,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

// The PDF engine (react-pdf → pdfjs-dist) touches browser-only globals the
// moment its module is evaluated, which crashes Next.js SSR even inside a
// "use client" file. Loading it with `ssr: false` keeps it out of the
// server bundle entirely — see pdf-viewer.tsx for details.
const PdfViewer = dynamic(() => import("./pdf-viewer"), {
  ssr: false,
  loading: () => <PdfFallbackSkeleton />,
});

function PdfFallbackSkeleton() {
  return <Skeleton className="h-[70vh] w-[54vh] max-w-full rounded-sm" />;
}

// ── Types ──────────────────────────────────────────────────────────────

type FileKind = "pdf" | "docx" | "xlsx" | "unsupported";

interface SheetData {
  name: string;
  rows: string[][];
  merges: SheetMerge[];
}

export interface FilePreviewCanvasProps {
  /** The single source of truth for content — everything is derived from this URL. */
  url: string;
  fileName?: string | null;
  fileType?: string | null;
  /**
   * Called once, right when the user dismisses the preview (✕ button,
   * Escape key, or clicking the blurred backdrop). This component only
   * hides itself locally on close — it never unmounts itself. If it's
   * rendered from external state (Redux, a modal manager, etc.), wire this
   * to whatever action actually removes it from the tree. Otherwise the
   * same mounted instance is reused on the next "open," and its internal
   * open state is still stuck at false — see the file header for the
   * common Redux-modal-manager gotcha this solves.
   */
  onClose?: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

function detectFileKind(
  url: string,
  fileName?: string | null,
  fileType?: string | null,
): FileKind {
  const mime = fileType?.toLowerCase() ?? "";
  if (mime === "application/pdf") return "pdf";
  if (
    mime
    === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || mime === "application/vnd.ms-excel.sheet.macroenabled.12"
  )
    return "xlsx";
  const path = (fileName || url).split("?")[0].split("#")[0];
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  // ExcelJS reads the OOXML formats only, so a legacy binary .xls is not
  // previewable — it falls through to the unsupported card and its download.
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  return "unsupported";
}

function getFileName(url: string, fileName?: string | null): string {
  if (fileName) return fileName;
  try {
    const path = url.split("?")[0].split("#")[0];
    return decodeURIComponent(
      path.split("/").filter(Boolean).pop() || "Untitled",
    );
  } catch {
    return "Untitled";
  }
}

function columnLetter(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode((n % 26) + 65) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

const FILE_META: Record<
  FileKind,
  { label: string; accent: string; Icon: React.ElementType }
> = {
  pdf: {
    label: "PDF",
    accent: "text-destructive-ink",
    Icon: FileText,
  },
  docx: {
    label: "DOCX",
    accent: "text-info-ink",
    Icon: FileText,
  },
  xlsx: {
    label: "XLSX",
    accent: "text-success-ink",
    Icon: FileSpreadsheet,
  },
  unsupported: {
    label: "FILE",
    accent: "text-muted-foreground",
    Icon: FileWarning,
  },
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.25;

// ── Small building blocks ─────────────────────────────────────────────

function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function CenteredMessage({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-10 text-center">
      {icon}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

// ── DOCX viewer ────────────────────────────────────────────────────────

function DocxViewer({
  url,
  zoom,
  onReady,
  onError,
}: {
  url: string;
  zoom: number;
  onReady: () => void;
  onError: (message: string) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Keep latest callbacks in refs so the load effect only re-runs when the
  // URL actually changes — not on every parent re-render (e.g. zoom clicks).
  const onReadyRef = React.useRef(onReady);
  const onErrorRef = React.useRef(onError);
  React.useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onReady, onError]);

  React.useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled || !containerRef.current) return;
        await renderAsync(blob, containerRef.current, undefined, {
          className: "docx-preview",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          useBase64URL: true,
        });
        if (!cancelled) onReadyRef.current();
      } catch {
        if (!cancelled)
          onErrorRef.current(
            "This Word document couldn't be loaded. It may be corrupted or blocked by CORS.",
          );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="flex justify-center py-6">
      <div
        ref={containerRef}
        style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
        className="[&_.docx-preview]:bg-transparent! [&_section.docx]:mb-6 [&_section.docx]:shadow-md! [&_section.docx]:ring-1 [&_section.docx]:ring-border"
      />
    </div>
  );
}

// ── XLSX viewer ────────────────────────────────────────────────────────

function buildMergeLookup(merges: SheetMerge[]) {
  const skip = new Set<string>();
  const anchors = new Map<string, { rowSpan: number; colSpan: number }>();
  for (const m of merges) {
    const rowSpan = m.endRow - m.startRow + 1;
    const colSpan = m.endColumn - m.startColumn + 1;
    anchors.set(`${m.startRow}_${m.startColumn}`, { rowSpan, colSpan });
    for (let r = m.startRow; r <= m.endRow; r++) {
      for (let c = m.startColumn; c <= m.endColumn; c++) {
        if (r === m.startRow && c === m.startColumn) continue;
        skip.add(`${r}_${c}`);
      }
    }
  }
  return { skip, anchors };
}

function XlsxViewer({ sheet, zoom }: { sheet: SheetData; zoom: number }) {
  const { skip, anchors } = React.useMemo(
    () => buildMergeLookup(sheet.merges),
    [sheet.merges],
  );
  const colCount = React.useMemo(
    () => sheet.rows.reduce((max, row) => Math.max(max, row.length), 1),
    [sheet.rows],
  );

  return (
    <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 h-7 w-10 border border-border bg-muted" />
            {Array.from({ length: colCount }).map((_, c) => (
              <th
                key={c}
                className="sticky top-0 z-10 h-7 min-w-27.5 border border-border bg-muted px-2 text-xs font-medium text-muted-foreground"
              >
                {columnLetter(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row, r) => (
            <tr key={r} className={r % 2 === 1 ? "bg-muted/30" : undefined}>
              <td className="sticky left-0 z-10 border border-border bg-muted px-2 text-center text-xs font-medium text-muted-foreground">
                {r + 1}
              </td>
              {Array.from({ length: colCount }).map((_, c) => {
                const key = `${r}_${c}`;
                if (skip.has(key)) return null;
                const span = anchors.get(key);
                return (
                  <td
                    key={c}
                    rowSpan={span?.rowSpan}
                    colSpan={span?.colSpan}
                    className="max-w-70 truncate whitespace-nowrap border border-border px-2 py-1 text-foreground"
                    title={row[c] ?? ""}
                  >
                    {row[c] ?? ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export default function FilePreviewCanvas({
  url,
  fileName,
  fileType,
  onClose,
}: FilePreviewCanvasProps) {
  const kind = React.useMemo(
    () => detectFileKind(url, fileName, fileType),
    [url, fileName, fileType],
  );
  const displayFileName = React.useMemo(
    () => getFileName(url, fileName),
    [url, fileName],
  );
  const meta = FILE_META[kind];

  const [open, setOpen] = React.useState(true);
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) onClose?.();
    },
    [onClose],
  );
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [zoom, setZoom] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [loading, setLoading] = React.useState(kind !== "unsupported");
  const [error, setError] = React.useState<string | null>(null);

  // pdf
  const [page, setPage] = React.useState(1);
  const [numPages, setNumPages] = React.useState(0);

  // xlsx
  const [sheets, setSheets] = React.useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = React.useState(0);

  // Reset all per-file state whenever the URL changes.
  React.useEffect(() => {
    setTimeout(() => {
      setOpen(true);
      setZoom(1);
      setRotation(0);
      setPage(1);
      setNumPages(0);
      setSheets([]);
      setActiveSheet(0);
      setError(null);
      setLoading(kind !== "unsupported");
    }, 0);
  }, [url, kind]);

  // Load XLSX workbooks up front (PDF/DOCX load themselves).
  React.useEffect(() => {
    if (kind !== "xlsx") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const buffer = await res.arrayBuffer();
        const workbook = await readWorkbookGrid(buffer);
        const parsed: SheetData[] = [...workbook.values()].map((sheet) => ({
          name: sheet.name,
          rows: sheet.display.map((row) => [...row]),
          merges: [...sheet.merges],
        }));
        if (!cancelled) {
          setSheets(parsed);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(
            "This spreadsheet couldn't be loaded. It may be corrupted or blocked by CORS.",
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, kind]);

  // Keyboard shortcuts.
  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (kind === "pdf" && numPages > 1) {
        if (e.key === "ArrowRight") setPage((p) => Math.min(p + 1, numPages));
        if (e.key === "ArrowLeft") setPage((p) => Math.max(p - 1, 1));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, kind, numPages]);

  const zoomIn = React.useCallback(
    () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))),
    [],
  );
  const zoomOut = React.useCallback(
    () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))),
    [],
  );
  const resetZoom = React.useCallback(() => setZoom(1), []);

  const handleDownload = React.useCallback(async () => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = displayFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [url, displayFileName]);

  const handlePrint = React.useCallback(() => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.src = url;
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 1000);
    };
    document.body.appendChild(iframe);
  }, [url]);

  if (!open) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/60 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => e.preventDefault()}
            className={cn(
              "fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-border bg-card shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              isFullscreen
                ? "h-screen w-screen max-w-none rounded-none"
                : "h-[88vh] w-[92vw] max-w-5xl rounded-xl",
            )}
          >
            <DialogPrimitive.Title className="sr-only">
              {displayFileName} preview
            </DialogPrimitive.Title>

            {/* Header / toolbar */}
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card/95 px-3 py-2">
              <meta.Icon className={cn("h-4 w-4 shrink-0", meta.accent)} />
              <span
                className="truncate text-sm font-medium text-foreground"
                title={displayFileName}
              >
                {displayFileName}
              </span>
              <Badge
                variant="secondary"
                className="shrink-0 text-[10px] font-semibold tracking-wide"
              >
                {meta.label}
              </Badge>

              <div className="ml-auto flex items-center gap-1">
                {kind === "pdf" && numPages > 0 && (
                  <>
                    <ToolbarButton
                      label="Previous page"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </ToolbarButton>
                    <span className="min-w-16 text-center text-xs text-muted-foreground tabular-nums">
                      {page} / {numPages}
                    </span>
                    <ToolbarButton
                      label="Next page"
                      onClick={() => setPage((p) => Math.min(numPages, p + 1))}
                      disabled={page >= numPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </ToolbarButton>
                    <Separator orientation="vertical" className="mx-1 h-5" />
                    <ToolbarButton
                      label="Rotate"
                      onClick={() => setRotation((r) => (r + 90) % 360)}
                    >
                      <RotateCw className="h-4 w-4" />
                    </ToolbarButton>
                  </>
                )}

                {(kind === "pdf" || kind === "docx" || kind === "xlsx") && (
                  <>
                    <ToolbarButton
                      label="Zoom out"
                      onClick={zoomOut}
                      disabled={zoom <= ZOOM_MIN}
                    >
                      <ZoomOut className="h-4 w-4" />
                    </ToolbarButton>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={resetZoom}
                          className="min-w-12 rounded px-1 text-center text-xs text-muted-foreground tabular-nums hover:bg-accent"
                        >
                          {Math.round(zoom * 100)}%
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Reset zoom</TooltipContent>
                    </Tooltip>
                    <ToolbarButton
                      label="Zoom in"
                      onClick={zoomIn}
                      disabled={zoom >= ZOOM_MAX}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </ToolbarButton>
                    <Separator orientation="vertical" className="mx-1 h-5" />
                  </>
                )}

                {kind === "pdf" && (
                  <ToolbarButton label="Print" onClick={handlePrint}>
                    <Printer className="h-4 w-4" />
                  </ToolbarButton>
                )}
                <ToolbarButton label="Download" onClick={handleDownload}>
                  <Download className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  onClick={() => setIsFullscreen((f) => !f)}
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </ToolbarButton>
                <Separator orientation="vertical" className="mx-1 h-5" />
                <DialogPrimitive.Close asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </DialogPrimitive.Close>
              </div>
            </div>

            {/* Sheet tabs for xlsx */}
            {kind === "xlsx" && sheets.length > 1 && (
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/40 px-2 py-1.5">
                {sheets.map((s, i) => (
                  <button
                    key={s.name}
                    onClick={() => setActiveSheet(i)}
                    className={cn(
                      "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      i === activeSheet
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                        : "text-muted-foreground hover:bg-background/60",
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {/* Body */}
            <div className="relative flex-1 overflow-hidden bg-muted/20">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/20">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Loading preview…
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <CenteredMessage
                  icon={
                    <FileWarning className="h-8 w-8 text-muted-foreground" />
                  }
                  title="Couldn't preview this file"
                  description={error}
                  action={
                    <div className="mt-1 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          window.open(url, "_blank", "noopener,noreferrer")
                        }
                      >
                        Open original
                      </Button>
                      <Button size="sm" onClick={handleDownload}>
                        Download
                      </Button>
                    </div>
                  }
                />
              )}

              {!error && kind === "unsupported" && (
                <CenteredMessage
                  icon={
                    <FileWarning className="h-8 w-8 text-muted-foreground" />
                  }
                  title="Unsupported file type"
                  description="This preview supports PDF, DOCX and XLSX files. Save a legacy .xls workbook as .xlsx to preview it."
                  action={
                    <Button size="sm" onClick={handleDownload}>
                      Download file
                    </Button>
                  }
                />
              )}

              {!error && kind !== "unsupported" && (
                <ScrollArea className="h-full w-full">
                  <div className="min-h-full min-w-full p-6">
                    {kind === "pdf" && (
                      <PdfViewer
                        url={url}
                        zoom={zoom}
                        rotation={rotation}
                        page={page}
                        onDocLoad={(n) => {
                          setNumPages(n);
                          setLoading(false);
                        }}
                        onError={(msg) => {
                          setError(msg);
                          setLoading(false);
                        }}
                      />
                    )}
                    {kind === "docx" && (
                      <DocxViewer
                        url={url}
                        zoom={zoom}
                        onReady={() => setLoading(false)}
                        onError={(msg) => {
                          setError(msg);
                          setLoading(false);
                        }}
                      />
                    )}
                    {kind === "xlsx" && sheets[activeSheet] && (
                      <XlsxViewer sheet={sheets[activeSheet]} zoom={zoom} />
                    )}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </TooltipProvider>
  );
}
