"use client";
import React, { forwardRef } from "react";
import { renderEmailHtml } from "@/lib/leads/render-email-html";
import { Lead } from "@/lib/leads/types";
import { useQuery } from "@tanstack/react-query";

interface ReactEmailPreviewProps {
  category: string;
  lead: Lead | null;
  editable?: boolean;
}

const Spinner = () => (
  <div className="flex h-120 items-center justify-center rounded-lg border border-border bg-muted/10">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-teal-600" />
  </div>
);

function addEditableBody(html: string) {
  const focusStyles = `
    <style>
      body.editable-email-preview:focus,
      body.editable-email-preview:focus-visible {
        outline: 3px solid #0D9488;
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

export const ReactEmailIframe = forwardRef<HTMLIFrameElement, ReactEmailPreviewProps>(
  ({ category, lead, editable = true }, ref) => {
    const { data: html, isLoading } = useQuery({
      queryKey: ["email-preview", category, lead?.id],
      queryFn: () => renderEmailHtml(category, lead),
    });

    if (isLoading) {
      return <Spinner />;
    }

    const previewHtml = editable && html ? addEditableBody(html) : (html ?? "");

    return (
      <div
        className="overflow-hidden rounded-lg border border-border"
        style={{ height: 480 }}
      >
        <iframe
          ref={ref}
          title={`${category} Email Preview`}
          srcDoc={previewHtml}
          className="w-full h-full"
          sandbox="allow-same-origin allow-scripts"
          style={{ border: "none" }}
        />
      </div>
    );
  }
);

ReactEmailIframe.displayName = "ReactEmailIframe";
