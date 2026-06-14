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
  const content = (
    <>
      <CardHeader className="pb-3 max-sm:p-3 max-sm:pb-1">
        <div className="flex items-start justify-between gap-4 max-sm:gap-2">
          <div>
            <CardDescription className="max-sm:text-xs">{label}</CardDescription>
            <CardTitle className="mt-2 font-heading text-3xl font-semibold tracking-tight max-sm:mt-1 max-sm:text-2xl">
              {value}
            </CardTitle>
          </div>
          {Icon ? (
            <div className={cn("grid size-11 place-items-center rounded-2xl max-sm:size-9 max-sm:rounded-xl", toneMap[tone])}>
              <Icon className="size-5 max-sm:size-4" />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pb-4 text-sm text-muted-foreground max-sm:p-3 max-sm:pt-0 max-sm:text-xs">
        {note}
      </CardContent>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        className={cn(
          "group/card flex flex-col gap-4 overflow-hidden rounded-lg bg-card py-4 text-left text-sm text-card-foreground ring-1 ring-foreground/10 transition-all duration-200 max-sm:gap-2 max-sm:py-2",
          "cursor-pointer select-none hover:border-muted-foreground/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          active ? `ring-2 ${activeRingMap[tone]} border-transparent shadow-md` : "border-border/70 bg-white/95 shadow-sm",
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
        "border-border/70 bg-white/95 shadow-sm transition-all duration-200 max-sm:gap-2 max-sm:py-2",
        active ? `ring-2 ${activeRingMap[tone]} border-transparent shadow-md` : ""
      )}
    >
      {content}
    </Card>
  )
}
