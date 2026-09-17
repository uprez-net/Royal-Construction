"use client";

import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  titleAs = "h2",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Heading level for the section title. Defaults to "h2", correct for a
   * top-level section card sitting beneath the page <h1>. Drop to "h3" when the
   * card is nested inside another titled section, or "div" to opt out.
   */
  titleAs?: "div" | "h2" | "h3" | "h4";
}) {
  return (
    <Card className={className ?? "bg-card shadow-sm"}>
      <CardHeader className="space-y-2 border-b border-border/70 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <CardTitle
              as={titleAs}
              className="text-lg font-semibold sm:text-xl"
            >
              {title}
            </CardTitle>
            {description ? (
              <CardDescription className="mt-1 break-words">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {action ? <div className="shrink-0 self-start">{action}</div> : null}
        </div>
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
    </Card>
  );
}
