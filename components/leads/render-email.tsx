"use client";
import React, { forwardRef } from "react";
import { renderEmailHtml } from "@/lib/leads/render-email-html";
import { Lead } from "@/lib/leads/types";
import { useQuery } from "@tanstack/react-query";

interface ReactEmailPreviewProps {
  category: string;
  lead: Lead | null;
}

const Spinner = () => (
  <div className="flex h-120 items-center justify-center rounded-lg border border-border bg-muted/10">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-teal-600" />
  </div>
);

export const ReactEmailIframe = forwardRef<HTMLIFrameElement, ReactEmailPreviewProps>(
  ({ category, lead }, ref) => {
    const { data: html, isLoading } = useQuery({
      queryKey: ["email-preview", category, lead?.id],
      queryFn: () => renderEmailHtml(category, lead),
    });

    if (isLoading) {
      return <Spinner />;
    }

    // Inject contenteditable="true" and remove focus outline on the email's body tag
    const editableHtml = html
      ? html.replace(/<body([^>]*)>/i, '<body$1 contenteditable="true" style="outline: none;">')
      : "";

    return (
      <div
        className="overflow-hidden rounded-lg border border-border"
        style={{ height: 480 }}
      >
        <iframe
          ref={ref}
          title={`${category} Email Preview`}
          srcDoc={editableHtml}
          className="w-full h-full"
          sandbox="allow-same-origin allow-scripts"
          style={{ border: "none" }}
        />
      </div>
    );
  }
);

ReactEmailIframe.displayName = "ReactEmailIframe";