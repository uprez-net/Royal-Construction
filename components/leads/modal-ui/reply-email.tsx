"use client";

import { Reply, X } from "lucide-react";
import type { LeadEmails } from "@prisma/client";

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
  return (
    <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
      <Reply className="size-3.5 shrink-0 text-primary" />

      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Replying to
        </p>
        <p className="truncate text-xs text-foreground">
          {email.body.replace(/\s+/g, " ").trim()}
        </p>
      </div>

      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
        className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
