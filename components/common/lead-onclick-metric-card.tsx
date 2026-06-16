"use client"

import type { ComponentType } from "react"

import { Card, CardContent } from "@/components/ui/card"
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
  const content = (
    <div className="grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3">
      {Icon ? (
        <div className={cn("grid size-9 place-items-center rounded-lg", toneMap[tone])}>
          <Icon className="size-4" />
        </div>
      ) : null}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="font-heading text-2xl font-semibold leading-none tracking-tight text-foreground">
            {value}
          </p>
          <p className="truncate text-xs font-medium text-muted-foreground">
            {label}
          </p>
        </div>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {note}
        </p>
      </div>
    </div>
  )

  if (onClick) {
    return (
      <button
        type="button"
        className={cn(
          "group/card overflow-hidden rounded-lg border text-left text-sm text-card-foreground transition-all duration-200",
          "cursor-pointer select-none hover:border-muted-foreground/30 hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          active ? `border-transparent bg-white ring-2 ${activeRingMap[tone]} shadow-md` : "border-border/70 bg-white/95 shadow-sm",
        )}
        onClick={onClick}
        aria-pressed={active}
        aria-label={`${label}: ${value}. ${note}`}
      >
        {content}
      </button>
    )
  }

  return (
    <Card
      className={cn(
        "overflow-hidden rounded-lg border-border/70 bg-white/95 shadow-sm transition-all duration-200",
        active ? `border-transparent ring-2 ${activeRingMap[tone]} shadow-md` : ""
      )}
    >
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  )
}
