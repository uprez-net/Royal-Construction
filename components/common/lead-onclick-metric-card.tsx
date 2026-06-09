"use client"

import type { ComponentType } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const toneMap = {
  primary: "bg-teal-600 text-white",
  info: "bg-[#2563EB] text-white",
  success: "bg-emerald-500 text-white",
  warning: "bg-amber-500 text-white",
  danger: "bg-red-500 text-white",
  badge: "bg-[#E8730C] text-white",
}

const activeRingMap = {
  primary: "ring-teal-600",
  info: "ring-[#2563EB]",
  success: "ring-emerald-600",
  warning: "ring-amber-500",
  danger: "ring-red-500",
  badge: "ring-[#E8730C]",
}

export function LeadMetricCard({
  label,
  value,
  note,
  tone = "primary",
  icon: Icon,
  onClick,
  active = false,
}: {
  label: string
  value: string
  note: string
  tone?: keyof typeof toneMap
  icon?: ComponentType<{ className?: string }>
  onClick?: () => void
  active?: boolean
}) {
  return (
    <Card 
      className={cn(
        "border-border/70 bg-white/95 shadow-sm transition-all duration-200",
        onClick ? "cursor-pointer select-none hover:shadow-md hover:border-muted-foreground/30" : "",
        active ? `ring-2 ${activeRingMap[tone]} border-transparent shadow-md` : ""
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardDescription>{label}</CardDescription>
            <CardTitle className="mt-2 font-heading text-3xl font-semibold tracking-tight">{value}</CardTitle>
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