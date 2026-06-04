"use client";
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

export function ReactEmailIframe({ category, lead }: ReactEmailPreviewProps) {
  const { data: html, isLoading } = useQuery({
    queryKey: ["email-preview", category, lead?.id],
    queryFn: () => renderEmailHtml(category, lead),
  });

  if(isLoading) {
    return <Spinner />;
  }

  return (
      <div
        className="overflow-hidden rounded-lg border border-border"
        style={{ height: 480 }}
      >
        <iframe
          title={`${category} Email Preview`}
          srcDoc={html as unknown as string}
          className="w-full h-full"
          sandbox="allow-same-origin allow-scripts"
          style={{ border: "none" }}
        />
      </div>
  );
}
