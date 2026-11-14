"use client";

import { useState } from "react";
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
import { Command, CommandGroup, CommandItem } from "@/components/ui/command";

import { cn } from "@/lib/utils";
import { OfferStatusLabels } from "@/types/offer";

const YELLOW =
  "border-yellow-300 bg-yellow-100 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200 hover:shadow-yellow-300/50";
const BLUE =
  "border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 hover:shadow-blue-300/50";
const GREEN =
  "border-green-300 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200 hover:shadow-green-300/50";
const RED =
  "border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200 hover:shadow-red-300/50";
const GRAY =
  "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 hover:shadow-slate-300/50";

const statusStyle: Record<OfferStatus, string> = {
  PENDING: YELLOW,
  SENT: BLUE,
  ACCEPTED: GREEN,
  REJECTED: RED,
  // New lifecycle states (driven by the offer workspace, not this badge)
  OFFER_SENT: BLUE,
  OFFER_SIGNED: GREEN,
  OFFER_DECLINED: RED,
  AGREED: GREEN,
  TENDER_DRAFT: YELLOW,
  TENDER_SENT: BLUE,
  TENDER_SIGNED: GREEN,
  TENDER_DECLINED: RED,
  CONTRACT_DRAFT: YELLOW,
  CONTRACT_SENT: BLUE,
  CONTRACT_SIGNED: GREEN,
  CONTRACT_DECLINED: RED,
  PROJECT: GREEN,
  SUPERSEDED: GRAY,
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

  const Icon = StatusIcon[status];
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
              "gap-1.5 rounded-full px-3 py-1 transition-all",
              "cursor-pointer hover:shadow-sm",
              "disabled:pointer-events-none",
              statusStyle[status],
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{OfferStatusLabels[status]}</span>

            {availableTransitions.length > 0 && (
              <ChevronDown className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
            )}
          </Badge>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-56 p-1">
        <Command label="Change status">
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
        </Command>
      </PopoverContent>
    </Popover>
  );
}
