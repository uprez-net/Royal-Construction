import { renderEmailHtml } from "@/lib/leads/render-email-html";
import { Lead } from "@/lib/leads/types";
import { Suspense, use } from "react";

interface ReactEmailPreviewProps {
  category: string;
  lead: Lead | null;
}

const Spinner = () => (
  <div className="flex h-120 items-center justify-center rounded-lg border border-border bg-muted/10">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-teal-600" />
  </div>
);

export function ReactEmailIframe({ category, lead }: ReactEmailPreviewProps) {
  const html = use(renderEmailHtml(category, lead));

  if (!html) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        No preview available
      </div>
    );
  }

  return (
    <Suspense fallback={<Spinner />}>
      <div
        className="overflow-hidden rounded-lg border border-border"
        style={{ height: 480 }}
      >
        <iframe
          title={`${category} Email Preview`}
          srcDoc={html}
          className="w-full h-full"
          sandbox="allow-same-origin allow-scripts"
          style={{ border: "none" }}
        />
      </div>
    </Suspense>
  );
}
