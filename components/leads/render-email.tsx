"use client";
import React, { forwardRef } from "react";
import { renderEmailHtml } from "@/lib/leads/render-email-html";
import { Lead } from "@/lib/leads/types";
import { useQuery } from "@tanstack/react-query";
import { getEditablePreviewHtml } from "@/lib/utils/email-preview";

interface ReactEmailPreviewProps {
  category: string;
  lead: Lead | null;
  editable?: boolean;
}

const Spinner = () => (
  <div className="flex h-120 items-center justify-center rounded-lg border border-border bg-muted/10">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-royal-gold-ink" />
  </div>
);

function addEditableBody(html: string) {
  const focusStyles = `
    <style>
      body.editable-email-preview:focus,
      body.editable-email-preview:focus-visible {
        /* Gold ink (--royal-gold-ink). This CSS is injected into the preview
           document, which cannot read the app's custom properties. */
        outline: 3px solid #926100;
        outline-offset: -3px;
      }
    </style>
  `;

  return html
    .replace(/<\/head>/i, `${focusStyles}</head>`)
    .replace(/<body([^>]*)>/i, (_match, attrs: string) => {
      const attrsWithClass = /class=/.test(attrs)
        ? attrs.replace(
            /class=(["'])(.*?)\1/,
            'class="$2 editable-email-preview"',
          )
        : `${attrs} class="editable-email-preview"`;

      return `<body${attrsWithClass} contenteditable="true" tabindex="0">`;
    });
}

export const ReactEmailIframe = forwardRef<
  HTMLIFrameElement,
  ReactEmailPreviewProps
>(({ category, lead, editable = true }, ref) => {
  const { data: html, isLoading } = useQuery({
    queryKey: ["email-preview", category, lead?.id],
    queryFn: () => renderEmailHtml(category, lead),
  });

  if (isLoading) {
    return <Spinner />;
  }

  // `editable` has to gate getEditablePreviewHtml too, not just the focus
  // styling. It used to wrap every preview regardless, and that wrapper is what
  // actually makes the body contenteditable and wires the toolbar that rewrites
  // link targets — so a preview asking to be read-only was still fully editable.
  //
  // That mattered once campaigns started rendering the body per recipient: the
  // campaign preview says editable={false} precisely because one edited body
  // cannot be correct for many recipients, but the operator could still retype
  // copy and rewrite URLs into it, and the send loop would then re-render from
  // the template and drop all of it without a word. A preview that cannot be
  // edited cannot silently lose edits.
  //
  // The single-lead composer passes nothing and keeps the default `true`: there
  // is exactly one recipient there, so editing the body is meaningful.
  const previewHtml = editable && html ? addEditableBody(html) : (html ?? "");
  return (
    <div className="overflow-hidden rounded-lg" style={{ height: 480 }}>
      <iframe
        ref={ref}
        title={`${category} Email Preview`}
        srcDoc={editable ? getEditablePreviewHtml(previewHtml) : previewHtml}
        className="w-full h-full"
        sandbox="allow-same-origin allow-scripts"
        style={{ border: "none" }}
      />
    </div>
  );
});

ReactEmailIframe.displayName = "ReactEmailIframe";
