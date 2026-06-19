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
import {
  Command,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

import { cn } from "@/lib/utils";
import { OfferStatusLabels } from "@/types/offer";

const statusStyle: Record<OfferStatus, string> = {
  PENDING:
    "border-yellow-300 bg-yellow-100 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200 hover:shadow-yellow-300/50",
  SENT:
    "border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 hover:shadow-blue-300/50",
  ACCEPTED:
    "border-green-300 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200 hover:shadow-green-300/50",
  REJECTED:
    "border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200 hover:shadow-red-300/50",
};

const StatusIcon: Record<OfferStatus, LucideIcon> = {
  PENDING: Hourglass,
  SENT: Send,
  ACCEPTED: CheckCircle,
  REJECTED: XCircle,
};

const OFFER_STATE_MACHINE: Record<OfferStatus, OfferStatus[]> = {
  PENDING: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: ["PENDING"],
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
              statusStyle[status]
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

      <PopoverContent
        align="start"
        className="w-56 p-1"
      >
        <Command>
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