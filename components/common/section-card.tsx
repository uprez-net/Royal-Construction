"use client"

import type { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className ?? "border-border/70 bg-white/95 shadow-sm"}>
      <CardHeader className="space-y-2 border-b border-border/70 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg font-semibold sm:text-xl">{title}</CardTitle>
            {description ? (
              <CardDescription className="mt-1 break-words">{description}</CardDescription>
            ) : null}
          </div>
          {action ? <div className="shrink-0 self-start">{action}</div> : null}
        </div>
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
    </Card>
  )
}
