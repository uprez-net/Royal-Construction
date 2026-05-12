import type { ComponentType } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const toneMap = {
  primary: "bg-teal-600 text-white",
  accent: "bg-orange-500 text-white",
  success: "bg-emerald-500 text-white",
  warning: "bg-amber-500 text-white",
  danger: "bg-red-500 text-white",
}

export function MetricCard({
  label,
  value,
  note,
  tone = "primary",
  icon: Icon,
}: {
  label: string
  value: string
  note: string
  tone?: keyof typeof toneMap
  icon?: ComponentType<{ className?: string }>
}) {
  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardDescription>{label}</CardDescription>
            <CardTitle className="mt-2 text-3xl font-semibold tracking-tight">{value}</CardTitle>
          </div>
          {Icon ? (
            <div className={cn("grid size-11 place-items-center rounded-2xl", toneMap[tone])}>
              <Icon className="size-5" />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pb-4 text-sm text-muted-foreground">{note}</CardContent>
    </Card>
  )
}
