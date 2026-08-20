"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LeadStage } from "@/lib/leads/types";
import { STAGE_STYLES, stageOptionsFor } from "@/lib/leads/lead-helpers";

const STAGE_DOT_STYLES: Record<LeadStage, string> = {
  New: "bg-blue-500",
  Contacted: "bg-amber-500",
  Qualified: "bg-purple-500",
  Quoted: "bg-teal-500",
  Negotiating: "bg-pink-500",
  Won: "bg-green-500",
  Lost: "bg-red-500",
  "Meeting Scheduled": "bg-blue-500",
  "In Follow-up": "bg-amber-500",
  "No Response": "bg-red-500",
  Converted: "bg-green-500",
  Cancelled: "bg-red-500",
  Disqualified: "bg-red-500",
};

interface StageBadgeSelectProps {
  value: LeadStage;
  onChange: (stage: LeadStage) => void | Promise<void>;
  disabled?: boolean;
}

export function StageBadgeSelect({ value, onChange, disabled }: StageBadgeSelectProps) {
  const [updating, setUpdating] = useState(false);

  async function handleSelect(stage: LeadStage) {
    if (stage === value) return;
    setUpdating(true);
    try {
      await onChange(stage);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || updating}>
        <Badge
          className={cn(
            "cursor-pointer select-none gap-1 border-none font-medium",
            STAGE_STYLES[value],
            (disabled || updating) && "cursor-default opacity-60"
          )}
        >
          {updating ? <Loader2 className="h-3 w-3 animate-spin" /> : value}
          {!updating && <ChevronDown className="h-3 w-3 opacity-60" />}
        </Badge>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-48">
        {/*
          The same list the Overview tab offers, not a second one built from
          STAGE_STYLES. That Record is keyed by every LeadStage, so this menu
          used to offer all thirteen and let anyone set Won or Cancelled from
          a page whose own Stage field hides both. Production never shipped
          this picker, so no habit is being broken by narrowing it.
        */}
        {stageOptionsFor(value).map((stage) => (
          <DropdownMenuItem key={stage} onSelect={() => handleSelect(stage)} className="gap-2">
            <span className={cn("h-2 w-2 rounded-full", STAGE_DOT_STYLES[stage])} />
            <span className="flex-1">{stage}</span>
            {stage === value && <Check className="h-4 w-4 opacity-70" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}