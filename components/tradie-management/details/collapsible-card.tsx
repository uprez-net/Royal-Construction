"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/**
 * A details-page card whose body folds away: the incidents and the activity
 * log, which can both run long below the details an operator came for.
 *
 * The disclosure pattern: a button inside the heading, so the heading stays a
 * heading for screen-reader navigation and the button names the section.
 * Radix wires `aria-expanded` and `aria-controls`. `onOpenChange` lets a card
 * load its body only once it is opened.
 */
export function CollapsibleCard({
  title,
  summary,
  defaultOpen = false,
  onOpenChange,
  actions,
  children,
}: {
  title: ReactNode;
  /** A short line under the title, shown open or closed: a count, a status. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Controls beside the title, such as a refresh button; shown when open. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
      asChild
    >
      <Card>
        <CardHeader className="flex flex-row items-start gap-2 space-y-0 pb-4">
          <div className="min-w-0 flex-1">
            <CardTitle as="h2">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="group -mx-2 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <ChevronDown
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]:-rotate-90 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                  {title}
                </button>
              </CollapsibleTrigger>
            </CardTitle>
            {summary ? (
              <p className="pl-6 text-xs text-muted-foreground">{summary}</p>
            ) : null}
          </div>
          {open && actions ? (
            <div className="flex shrink-0 items-center gap-1">{actions}</div>
          ) : null}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="p-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
