"use client";

import { Reply, X } from "lucide-react";
import type { LeadEmails } from "@prisma/client";
import { stripEmailBody } from "@/utils/formatters";

interface ReplyBannerProps {
  email: LeadEmails;
  onCancel: () => void;
}

/**
 * Small, reusable "replying to" chip. Shows which message is being replied
 * to and lets the user back out of the reply. Deliberately dumb/presentational
 * so it can be reused anywhere a reply context needs to be surfaced.
 */
export function ReplyBanner({ email, onCancel }: ReplyBannerProps) {
  const plainBody = stripEmailBody(email.body);
  return (
    <div className="mx-3 mt-2.5 flex items-start gap-2.5 rounded-xl border-l border-royal-gold bg-royal-gold-light/40 px-3 py-2">
      <Reply
        className="mt-0.5 size-3.5 shrink-0 text-royal-gold-ink"
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">
          Replying to “{email.subject}”
        </p>
        <p className="truncate text-xs text-muted-foreground">{plainBody}</p>
      </div>

      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
        className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
