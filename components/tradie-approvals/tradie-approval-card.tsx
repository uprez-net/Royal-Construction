"use client";

import {
  AlertTriangle,
  Calendar,
  Check,
  Clock3,
  Loader2,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TradieApprovalActionType, TradieApprovalStatus } from "@prisma/client";

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface ApprovalCardProps {
  type: TradieApprovalActionType;
  status: TradieApprovalStatus;

  title: string;
  subtitle?: string;
  description: string;

  requestedBy: string;
  createdAt: string;

  projectName?: string;

  severity?: Severity;
  severityLabel?: string;

  selected: boolean;
  disabled: boolean;

  onSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
  onClick: () => void;
}

const approvalConfig = {
  [TradieApprovalActionType.PRICE_CHANGE]: {
    label: "Price Change",
    icon: Tag,
    badgeClass:
      "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300",
  },

  [TradieApprovalActionType.INCIDENT_RESOLUTION]: {
    label: "Incident",
    icon: AlertTriangle,
    badgeClass:
      "bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300",
  },

  [TradieApprovalActionType.TRADIE_REMOVAL]: {
    label: "Deletion",
    icon: Trash2,
    badgeClass:
      "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300",
  },

  [TradieApprovalActionType.SCHEDULE_APPROVAL]: {
    label: "Scheduling",
    icon: Calendar,
    badgeClass:
      "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300",
  },
};

const severityConfig = {
  LOW: {
    dot: "bg-green-500",
    badge: "secondary",
  },
  MEDIUM: {
    dot: "bg-yellow-500",
    badge: "secondary",
  },
  HIGH: {
    dot: "bg-orange-500",
    badge: "destructive",
  },
  CRITICAL: {
    dot: "bg-red-600",
    badge: "destructive",
  },
} as const;

function StatusBadge({ status }: { status: TradieApprovalStatus }) {
  switch (status) {
    case TradieApprovalStatus.PENDING:
      return (
        <Badge variant="outline" className="gap-1 text-amber-600">
          <Clock3 className="h-3 w-3" />
          Pending
        </Badge>
      );

    case TradieApprovalStatus.APPROVED:
      return (
        <Badge className="gap-1">
          <Check className="h-3 w-3" />
          Approved
        </Badge>
      );

    case TradieApprovalStatus.REJECTED:
      return (
        <Badge variant="destructive" className="gap-1">
          <X className="h-3 w-3" />
          Rejected
        </Badge>
      );
  }
}

export function ApprovalCard({
  type,
  status,
  title,
  subtitle,
  description,
  requestedBy,
  createdAt,
  projectName,
  severity,
  severityLabel,
  selected,
  disabled,
  onSelect,
  onApprove,
  onReject,
  onClick,
}: ApprovalCardProps) {
  const config = approvalConfig[type];
  const Icon = config.icon;

  return (
    <div
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-xl border bg-card p-4 transition-all hover:shadow-md",
        selected && "ring-2 ring-primary",
      )}
    >
      <div className="flex gap-4">
        {onSelect && (
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={onSelect}
            className="mt-1"
          />
        )}

        <div className="flex-1 space-y-4">
          {/* Header */}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn("gap-1.5", config.badgeClass)}
              >
                <Icon className="h-3.5 w-3.5" />
                {config.label}
              </Badge>

              {severity && (
                <Badge variant={severityConfig[severity].badge}>
                  {severity}
                </Badge>
              )}

              <StatusBadge status={status} />
            </div>

            <div className="text-sm text-muted-foreground">
              {requestedBy} • {createdAt}
            </div>
          </div>

          {/* Body */}

          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{title}</h3>

              {subtitle && (
                <span className="text-sm text-muted-foreground">
                  ({subtitle})
                </span>
              )}
            </div>

            {severityLabel && severity && (
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    severityConfig[severity].dot,
                  )}
                />

                <span className="text-xs font-semibold uppercase">
                  {severityLabel}
                </span>
              </div>
            )}

            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          </div>

          {/* Footer */}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">{projectName}</div>

            {status === TradieApprovalStatus.PENDING && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    onApprove();
                  }}
                >
                  {disabled ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Approving...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Approve
                    </>
                  )}
                </Button>

                <Button
                  size="sm"
                  variant="destructive"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReject();
                  }}
                >
                  {disabled ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Rejecting...
                    </>
                  ) : (
                    <>
                      <X className="mr-1 h-4 w-4" />
                      Reject
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
