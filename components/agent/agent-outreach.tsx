"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Mail,
  Maximize2,
  Minimize2,
  Paperclip,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { humanizeEnum, stripHtml } from "@/components/agent/agent-format";
import { formatSydneyDateTime } from "@/lib/dates/sydney";
import { cn } from "@/lib/utils";

export type AgentOutreachDetails = {
  alertId: string | null;
  alertType: string | null;
  attachmentCount: number;
  body: string;
  contactEmail: string | null;
  contactName: string | null;
  daysOpen: number | null;
  lastFollowUpAt: string | null;
  party: string;
  subject: string | null;
  slaStatus: string | null;
};

/**
 * The email a party is about to receive, shown the way they will receive it.
 *
 * This is the most consequential thing this UI renders: it goes to a builder,
 * a certifier or an insurer, there is no support desk to walk back a wrong
 * recipient or a mangled body, and the operator approves it from here. So the
 * body is rendered, not flattened to text — a broken table or an unsubstituted
 * placeholder has to be visible before approval, not after.
 *
 * It is rendered twice-guarded. The HTML is sanitized with DOMPurify, then
 * written into an iframe with an empty `sandbox`, which gives it an opaque
 * origin and no scripts, forms, popups or navigation. Tool output is
 * model-influenced and assembled from CRM text the office did not write, so it
 * is treated as untrusted content even though the domain composes it.
 */
export function AgentOutreach({
  outreach,
}: {
  outreach: AgentOutreachDetails;
}) {
  const [view, setView] = useState<"preview" | "text">("preview");
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const plainText = useMemo(() => stripHtml(outreach.body), [outreach.body]);
  // DOMPurify needs a DOM, so the sanitized document is built on the client.
  // The server and the first hydration render agree on an empty frame.
  const onClient = useSyncExternalStore(subscribeNever, onTrue, onFalse);
  const previewHtml = useMemo(
    () => (onClient ? previewDocument(outreach.body) : ""),
    [onClient, outreach.body],
  );
  const missingRecipient = !outreach.contactEmail;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
    } catch {
      toast.error("Could not copy the email body.");
    }
  }

  return (
    <section
      aria-label={`Outreach email to the ${humanizeEnum(outreach.party).toLowerCase()}`}
      className="overflow-hidden rounded-xl border border-royal-gold/35 bg-royal-gold-light/25"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-royal-gold/25 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-royal-gold text-royal-gold-ink">
          <Mail aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {humanizeEnum(outreach.party)} outreach
          </p>
          <p className="text-[11px] text-muted-foreground">
            Draft · not sent until you approve it
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {outreach.slaStatus ? (
            <Badge
              variant={outreach.slaStatus === "OPEN" ? "default" : "outline"}
            >
              {humanizeEnum(outreach.slaStatus)}
            </Badge>
          ) : null}
          {outreach.daysOpen !== null ? (
            <Badge variant="outline">
              <Clock data-icon="inline-start" />
              {outreach.daysOpen}d open
            </Badge>
          ) : null}
          {outreach.attachmentCount > 0 ? (
            <Badge variant="outline">
              <Paperclip data-icon="inline-start" />
              {outreach.attachmentCount}
            </Badge>
          ) : null}
        </div>
      </header>

      <dl className="flex flex-col gap-1.5 border-b border-royal-gold/20 bg-background/70 px-3 py-2.5 text-xs">
        <Row label="From">
          <span className="text-foreground/80">Royal Constructions</span>
        </Row>
        <Row label="To">
          {missingRecipient ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
              <AlertTriangle aria-hidden="true" className="size-3.5" />
              No recipient on file — this cannot be sent
            </span>
          ) : (
            <span className="font-semibold text-foreground">
              {outreach.contactName ? `${outreach.contactName} · ` : ""}
              {outreach.contactEmail}
            </span>
          )}
        </Row>
        {outreach.subject ? (
          <Row label="Subject">
            <span className="font-semibold wrap-break-word text-foreground">
              {outreach.subject}
            </span>
          </Row>
        ) : null}
        {outreach.alertType ? (
          <Row label="Alert">
            <span className="text-foreground/80">
              {humanizeEnum(outreach.alertType)}
            </span>
          </Row>
        ) : null}
      </dl>

      <div className="flex items-center gap-1 border-b border-royal-gold/20 px-2 py-1.5">
        <ViewTab
          active={view === "preview"}
          label="Preview"
          onSelect={() => setView("preview")}
        />
        <ViewTab
          active={view === "text"}
          label="Plain text"
          onSelect={() => setView("text")}
        />
        <div className="ml-auto flex items-center gap-1">
          <Button
            aria-label={copied ? "Copied" : "Copy the email body"}
            onClick={() => void copyBody()}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </Button>
          <Button
            aria-label={expanded ? "Shrink the preview" : "Expand the preview"}
            onClick={() => setExpanded((open) => !open)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {expanded ? (
              <Minimize2 aria-hidden="true" />
            ) : (
              <Maximize2 aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      {view === "preview" ? (
        <iframe
          className={cn(
            "w-full border-0 bg-white transition-[height]",
            expanded ? "h-112" : "h-56",
          )}
          // No scripts, no same-origin, no forms, no navigation: an empty
          // sandbox is the strongest setting, and the preview needs none of it.
          sandbox=""
          srcDoc={previewHtml}
          title="Outreach email preview"
        />
      ) : (
        <pre
          className={cn(
            "overflow-auto whitespace-pre-wrap bg-white px-3 py-2.5 font-sans text-xs leading-relaxed text-foreground",
            expanded ? "max-h-112" : "max-h-56",
          )}
        >
          {plainText}
        </pre>
      )}

      {outreach.lastFollowUpAt ? (
        <p className="border-t border-royal-gold/20 px-3 py-2 text-[11px] text-muted-foreground">
          Last follow-up{" "}
          {formatSydneyDateTime(new Date(outreach.lastFollowUpAt))}
        </p>
      ) : null}
    </section>
  );
}

const subscribeNever = () => () => {};
const onTrue = () => true;
const onFalse = () => false;

function Row({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function ViewTab({
  active,
  label,
  onSelect,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-white text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onSelect}
      type="button"
    >
      {label}
    </button>
  );
}

/**
 * Sanitizes the body and wraps it in a self-contained document.
 *
 * `FORBID_TAGS` drops the elements that would let the preview reach back out of
 * the frame even if a future sandbox attribute were relaxed, and the stylesheet
 * is inlined so the frame never fetches anything.
 */
function previewDocument(body: string) {
  const safeBody = DOMPurify.sanitize(body, {
    FORBID_ATTR: ["srcdoc"],
    FORBID_TAGS: [
      "base",
      "embed",
      "form",
      "iframe",
      "object",
      "script",
      "style",
    ],
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root { color-scheme: light; }
  body {
    margin: 0;
    padding: 16px;
    background: #ffffff;
    color: #1f2937;
    font: 400 13px/1.6 Manrope, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    word-break: break-word;
  }
  p { margin: 0 0 0.85em; }
  p:last-child { margin-bottom: 0; }
  a { color: #8a6a1f; }
  strong { color: #111827; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
  img { max-width: 100%; height: auto; }
  ul, ol { margin: 0 0 0.85em; padding-left: 1.25em; }
  blockquote { margin: 0 0 0.85em; padding-left: 0.75em; border-left: 3px solid #e5e7eb; color: #4b5563; }
</style></head><body>${safeBody}</body></html>`;
}
