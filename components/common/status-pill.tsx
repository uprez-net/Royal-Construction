"use client"

import type { ReactNode, Key } from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const statusToneMap = {
  purple: "bg-purple-100 text-purple-700",
  primary: "bg-blue-100 text-blue-700",
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-red-100 text-red-700",
}

export function StatusPill({
  id,
  tone,
  children,
}: {
  id?: Key | null | undefined
  tone: keyof typeof statusToneMap
  children: ReactNode
}) {
  return <Badge key={id} className={cn("rounded-full px-3 py-1 text-xs font-semibold", statusToneMap[tone])}>{children}</Badge>
}
