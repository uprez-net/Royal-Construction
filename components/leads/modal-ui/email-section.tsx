"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { LeadEmails } from "@prisma/client";
import { ChevronDown, Inbox, Reply } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  chatDayKey,
  chatDayLabel,
  chatTime,
  initials,
} from "@/lib/whatsapp/chat-format";
import { dataTimeFormat, stripEmailBody } from "@/utils/formatters";

import { EmailComposer } from "./email-composer";

interface LeadEmailSectionProps {
  emails: LeadEmails[];
  leadId: number;
  leadEmail: string;
  projectType: string;
  location: string;
  isFullScreen?: boolean;
  appendEmailToLead: (leadId: number, email: LeadEmails) => void;
}

const ROYAL_DOMAIN = "@royalconstructions.com.au";

/** Longer than this and the body starts folded, with "Show more". */
const FOLD_AT = 420;

function sentAtIso(email: LeadEmails): string {
  return new Date(email.sentAt).toISOString();
}

function EmailMessage({
  email,
  sent,
  expandedByDefault,
  onReply,
}: {
  email: LeadEmails;
  sent: boolean;
  expandedByDefault: boolean;
  onReply: () => void;
}) {
  const body = useMemo(() => stripEmailBody(email.body), [email.body]);
  const long = body.length > FOLD_AT || body.split("\n").length > 8;
  const [expanded, setExpanded] = useState(expandedByDefault || !long);
  const counterpart = sent ? email.emailTo : email.emailFrom;
  const iso = sentAtIso(email);

  return (
    <article
      className={cn(
        "group relative rounded-lg border border-border/70 bg-card px-4 py-3.5",
      )}
      aria-label={`${sent ? "Sent" : "Received"} email: ${email.subject}`}
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            sent
              ? "bg-royal-gold-light text-royal-gold-ink"
              : "bg-muted text-muted-foreground",
          )}
        >
          {sent
            ? "RC"
            : initials(counterpart.split("@")[0]?.replace(/[._-]+/g, " "))}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="truncate text-sm font-semibold text-foreground">
              {sent ? "Royal Constructions" : email.emailFrom}
            </p>
            <time
              dateTime={iso}
              title={dataTimeFormat.format(new Date(email.sentAt))}
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {chatTime(iso)}
            </time>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            to {sent ? email.emailTo : "Royal Constructions"}
          </p>
        </div>
      </header>

      <div className="mt-2.5 pl-12">
        <h3 className="text-sm font-medium text-foreground">{email.subject}</h3>
        <p
          className={cn(
            "mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85",
            !expanded && "line-clamp-4",
          )}
        >
          {body}
        </p>
        <div className="mt-2 flex items-center gap-1">
          {long ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  expanded && "rotate-180",
                )}
                aria-hidden="true"
              />
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onReply}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          >
            <Reply className="size-3.5" aria-hidden="true" />
            Reply
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * A lead's (and its project's) email thread: the conversation as calm cards,
 * oldest first with the newest open, and the composer underneath.
 */
export function LeadEmailSection({
  emails,
  leadId,
  leadEmail,
  projectType,
  location,
  isFullScreen = false,
  appendEmailToLead,
}: LeadEmailSectionProps) {
  const [replyTarget, setReplyTarget] = useState<LeadEmails | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [now] = useState(() => new Date());

  // Oldest → newest, top to bottom, like any conversation.
  const orderedEmails = useMemo(
    () =>
      [...emails].sort(
        (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
      ),
    [emails],
  );

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [orderedEmails.length]);

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-background shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Email</h2>
          <p className="truncate text-xs text-muted-foreground">
            {leadEmail ? `With ${leadEmail}` : "No email address on file"}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
          {emails.length} {emails.length === 1 ? "email" : "emails"}
        </span>
      </div>

      <div
        ref={scroller}
        className={cn(
          "overflow-y-auto bg-muted/20 px-3 py-4 sm:px-5",
          isFullScreen ? "h-[min(58vh,620px)]" : "h-80",
        )}
      >
        {orderedEmails.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Inbox className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-foreground">
              No emails yet
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Write the first one below. Replies from the client appear here
              automatically.
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {orderedEmails.map((email, index) => {
              const iso = sentAtIso(email);
              const previous = orderedEmails[index - 1];
              const newDay =
                !previous
                || chatDayKey(sentAtIso(previous)) !== chatDayKey(iso);
              return (
                <Fragment key={email.id}>
                  {newDay ? (
                    <li
                      className="flex items-center gap-3 py-1"
                      aria-hidden="false"
                    >
                      <span className="h-px flex-1 bg-border/70" />
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {chatDayLabel(iso, now)}
                      </span>
                      <span className="h-px flex-1 bg-border/70" />
                    </li>
                  ) : null}
                  <li>
                    <EmailMessage
                      email={email}
                      sent={email.emailFrom.includes(ROYAL_DOMAIN)}
                      expandedByDefault={index === orderedEmails.length - 1}
                      onReply={() => setReplyTarget(email)}
                    />
                  </li>
                </Fragment>
              );
            })}
          </ol>
        )}
      </div>

      <EmailComposer
        leadId={leadId}
        to={leadEmail}
        replyTo={replyTarget}
        onCancelReply={() => setReplyTarget(null)}
        appendEmailToLead={appendEmailToLead}
        projectType={projectType}
        location={location}
      />
    </section>
  );
}
