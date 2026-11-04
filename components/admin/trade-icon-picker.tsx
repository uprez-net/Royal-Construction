"use client";

import { useState } from "react";

import { TradeIconGlyph } from "@/components/tradie-management/trade-icon";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { TRADE_ICON_KEYS, type TradeIconKey } from "@/types/trade-type";

/** "brick-wall" → "Brick wall", for the picker's accessible names. */
function iconName(icon: TradeIconKey): string {
  const words = icon.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Pick one of the icons an admin can give a trade (Admin → Trade types). */
export function IconPicker({
  value,
  onChange,
  disabled,
  compact = false,
}: {
  value: TradeIconKey;
  onChange: (icon: TradeIconKey) => void;
  disabled: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={compact ? "sm" : "default"}
          disabled={disabled}
          aria-label={`Icon: ${iconName(value)}. Change icon`}
          className={cn("gap-2", compact && "h-9")}
        >
          <TradeIconGlyph icon={value} className="size-4" />
          {compact ? null : "Icon"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div
          role="radiogroup"
          aria-label="Trade icon"
          className="grid grid-cols-5 gap-1 md:grid-cols-8"
        >
          {TRADE_ICON_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={key === value}
              aria-label={iconName(key)}
              title={iconName(key)}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
              className={cn(
                "flex size-11 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:size-8",
                key === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <TradeIconGlyph icon={key} className="size-4" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
