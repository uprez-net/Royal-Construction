"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type EmailPreviewFrameHandle = {
  /**
   * The email as it reads now, edits included, ready to send — or `null` while
   * the frame has not loaded. The editing attribute the preview adds is
   * stripped again, so a sent email is never itself editable.
   */
  readHtml: () => string | null;
};

const EDITABLE_ATTR = 'contenteditable="true"';

/** Make the email's own `<body>` editable for the preview only. */
function withEditableBody(html: string): string {
  return html.replace(/<body([^>]*)>/i, (match, attrs: string) =>
    /contenteditable=/i.test(attrs) ? match : `<body${attrs} ${EDITABLE_ATTR}>`,
  );
}

function withoutEditableBody(html: string): string {
  return html.replace(/<body([^>]*)>/i, (_match, attrs: string) => {
    const cleaned = attrs.replace(/\s*contenteditable="[^"]*"/i, "");
    return `<body${cleaned}>`;
  });
}

/**
 * A rendered email, scaled to fit, optionally editable in place.
 *
 * The email is laid out at its natural width inside the iframe (so nothing
 * wraps or overflows horizontally), then the iframe is visually shrunk with
 * `transform: scale()` to fit the panel width and `maxHeight`. The wrapper
 * reserves only the scaled footprint so the dialog around it stays compact.
 *
 * `layoutWidth` lays a fluid email out at that width instead of the iframe's
 * default 300px, which would otherwise squeeze it into a narrow column. Pass
 * `maxHeight={Infinity}` to fit the width only, so the text stays readable and
 * the caller scrolls the panel.
 *
 * Remount it (`key`) to throw away in-place edits; changing `html` reloads it
 * too.
 */
export const EmailPreviewFrame = forwardRef<
  EmailPreviewFrameHandle,
  {
    html: string;
    title: string;
    editable?: boolean;
    maxHeight?: number;
    minScale?: number;
    layoutWidth?: number;
  }
>(function EmailPreviewFrame(
  {
    html,
    title,
    editable = true,
    maxHeight = 560,
    minScale = 0.7,
    layoutWidth,
  },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const [size, setSize] = useState<{
    contentH: number;
    contentW: number;
    scale: number;
    /** Wider than the panel even at `minScale`. */
    overflowsX: boolean;
  } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      readHtml: () => {
        const doc = iframeRef.current?.contentDocument;
        if (!doc?.documentElement) return null;
        return `<!DOCTYPE html>\n${withoutEditableBody(doc.documentElement.outerHTML)}`;
      },
    }),
    [],
  );

  const syncFit = useCallback(() => {
    const iframe = iframeRef.current;
    const container = containerRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !container || !doc?.body) return;

    const contentW = Math.max(
      doc.documentElement.scrollWidth,
      doc.body.scrollWidth,
      layoutWidth ?? 0,
    );
    const contentH = Math.max(
      doc.documentElement.scrollHeight,
      doc.body.scrollHeight,
      0,
    );
    if (contentW <= 0 || contentH <= 0) return;

    iframe.style.width = `${contentW}px`;
    iframe.style.height = `${contentH}px`;

    const scale = Math.min(
      container.clientWidth / contentW,
      maxHeight / contentH,
      1,
    );
    const fitted = Math.max(scale, minScale);
    setSize({
      contentH,
      contentW,
      overflowsX: Math.ceil(contentW * fitted) > container.clientWidth,
      scale: fitted,
    });
  }, [layoutWidth, maxHeight, minScale]);

  const handleLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;

    syncFit();

    observerRef.current?.disconnect();
    const observer = new MutationObserver(syncFit);
    observerRef.current = observer;
    observer.observe(doc.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }, [syncFit]);

  // Refit when the panel itself resizes (dialog width, viewport).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => syncFit());
    observer.observe(container);
    return () => observer.disconnect();
  }, [syncFit]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  // Below `minScale` the document is wider than the panel: scroll it
  // sideways rather than cut off its right edge.
  const scaledW = size ? Math.ceil(size.contentW * size.scale) : null;
  const overflowsX = size?.overflowsX ?? false;

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-md border bg-transparent ${overflowsX ? "overflow-x-auto overflow-y-hidden" : "overflow-hidden"}`}
      style={{
        height: size
          ? Math.ceil(size.contentH * size.scale)
          : Number.isFinite(maxHeight)
            ? maxHeight
            : 560,
      }}
    >
      {/* A transform does not change layout size, so this box is what the
          panel measures and scrolls: the iframe as it looks once scaled. */}
      <div
        className="overflow-hidden"
        style={
          size && scaledW !== null
            ? { height: Math.ceil(size.contentH * size.scale), width: scaledW }
            : undefined
        }
      >
        <iframe
          ref={iframeRef}
          srcDoc={editable ? withEditableBody(html) : html}
          title={title}
          sandbox="allow-same-origin allow-scripts"
          onLoad={handleLoad}
          style={{
            width: layoutWidth,
            transformOrigin: "top left",
            transform: size ? `scale(${size.scale})` : undefined,
          }}
          className="block border-0 bg-background"
        />
      </div>
    </div>
  );
});
