"use client";

import { useRef, useState } from "react";
import { OfferStatus } from "@prisma/client";
import {
  CheckCircle,
  ChevronDown,
  Hourglass,
  Send,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import { cn } from "@/lib/utils";
import { OfferStatusLabels } from "@/types/offer";

type StatusTone =
  | "neutral"
  | "info"
  | "gold"
  | "success"
  | "warning"
  | "danger";

// Tint + ink pairs from the status tokens. The pill carries a 6px dot in the
// ink colour; the colour is the status, the label says it in words.
const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted text-foreground/80",
  info: "bg-info-light text-info-ink",
  gold: "bg-royal-gold-light text-royal-gold-ink-text",
  success: "bg-success-light text-success-ink",
  warning: "bg-warning-light text-warning-ink",
  danger: "bg-destructive-light text-destructive-ink",
};

// Drafts and superseded are neutral; sent is info, except Tender sent, which
// is gold because it is the active sales step. Declines are the only red.
const statusTone: Record<OfferStatus, StatusTone> = {
  PENDING: "neutral",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  OFFER_SENT: "info",
  OFFER_SIGNED: "success",
  OFFER_DECLINED: "danger",
  AGREED: "success",
  TENDER_DRAFT: "neutral",
  TENDER_SENT: "gold",
  TENDER_SIGNED: "success",
  TENDER_DECLINED: "danger",
  CONTRACT_DRAFT: "neutral",
  CONTRACT_SENT: "info",
  CONTRACT_SIGNED: "success",
  CONTRACT_DECLINED: "danger",
  PROJECT: "success",
  SUPERSEDED: "neutral",
};

const StatusIcon: Record<OfferStatus, LucideIcon> = {
  PENDING: Hourglass,
  SENT: Send,
  ACCEPTED: CheckCircle,
  REJECTED: XCircle,
  OFFER_SENT: Send,
  OFFER_SIGNED: CheckCircle,
  OFFER_DECLINED: XCircle,
  AGREED: CheckCircle,
  TENDER_DRAFT: Hourglass,
  TENDER_SENT: Send,
  TENDER_SIGNED: CheckCircle,
  TENDER_DECLINED: XCircle,
  CONTRACT_DRAFT: Hourglass,
  CONTRACT_SENT: Send,
  CONTRACT_SIGNED: CheckCircle,
  CONTRACT_DECLINED: XCircle,
  PROJECT: CheckCircle,
  SUPERSEDED: XCircle,
};

// This legacy leads badge does not drive the new lifecycle; those states are
// terminal here and progress via the offer workspace instead.
const OFFER_STATE_MACHINE: Record<OfferStatus, OfferStatus[]> = {
  PENDING: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: ["PENDING"],
  OFFER_SENT: [],
  OFFER_SIGNED: [],
  OFFER_DECLINED: [],
  AGREED: [],
  TENDER_DRAFT: [],
  TENDER_SENT: [],
  TENDER_SIGNED: [],
  TENDER_DECLINED: [],
  CONTRACT_DRAFT: [],
  CONTRACT_SENT: [],
  CONTRACT_SIGNED: [],
  CONTRACT_DECLINED: [],
  PROJECT: [],
  SUPERSEDED: [],
};

interface OfferStatusBadgeProps {
  status: OfferStatus;
  onStatusChange: (status: OfferStatus) => Promise<void> | void;
}

export function OfferStatusBadge({
  status,
  onStatusChange,
}: OfferStatusBadgeProps) {
  const [open, setOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  // Focus goes to the list, not the popup: the list is the cmdk element that
  // owns the arrow, Home, End and Enter keys and aria-activedescendant (#479).
  const listRef = useRef<HTMLDivElement>(null);

  const availableTransitions = OFFER_STATE_MACHINE[status];

  const handleStatusChange = async (nextStatus: OfferStatus) => {
    try {
      setIsUpdating(true);

      await onStatusChange?.(nextStatus);

      setOpen(false);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Popover
      open={open && availableTransitions.length > 0}
      onOpenChange={setOpen}
      modal
    >
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button
          disabled={isUpdating || availableTransitions.length === 0}
          className="group"
        >
          <Badge
            variant="outline"
            className={cn(
              "h-[22px] gap-1.5 rounded-full border-transparent px-2.5 text-[11.5px] font-semibold",
              "cursor-pointer disabled:pointer-events-none",
              TONE_CLASS[statusTone[status]],
            )}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-current"
            />
            <span>{OfferStatusLabels[status]}</span>

            {availableTransitions.length > 0 && (
              <ChevronDown className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
            )}
          </Badge>
        </button>
      </PopoverTrigger>

      <PopoverContent
        aria-label="Change status"
        align="start"
        className="w-56 p-1"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          listRef.current?.focus();
        }}
      >
        <Command>
          <CommandList ref={listRef} label="Change status">
            <CommandGroup heading="Change status">
              {availableTransitions.map((nextStatus) => {
                const NextIcon = StatusIcon[nextStatus];

                return (
                  <CommandItem
                    key={nextStatus}
                    disabled={isUpdating}
                    onSelect={() => handleStatusChange(nextStatus)}
                  >
                    <NextIcon className="mr-2 h-4 w-4" />
                    {OfferStatusLabels[nextStatus]}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
