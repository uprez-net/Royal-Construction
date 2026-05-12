import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type LegacyProjectCardProps = {
  name: string
  client: string
  status: string
  progress: number
  budget: string
  stage: string
}

type LiveProjectCardProps = {
  id: string
  name: string
  location: string
  status: string
  progressPercent: number
  spent: number
  totalBudget: number
  estimatedEndDate: string | Date
  customerName: string
}

type ProjectCardProps = LegacyProjectCardProps | LiveProjectCardProps

const statusToneMap: Record<string, string> = {
  "On Track": "bg-emerald-100 text-emerald-700",
  ACTIVE: "bg-teal-100 text-teal-700",
  ON_TRACK: "bg-emerald-100 text-emerald-700",
  NEEDS_ATTENTION: "bg-amber-100 text-amber-700",
  Delayed: "bg-red-100 text-red-700",
  DELAYED: "bg-red-100 text-red-700",
  COMPLETED: "bg-slate-100 text-slate-700",
  "Pending Quote": "bg-amber-100 text-amber-700",
}

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
})

const dateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
})

function formatStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ")
}

export function ProjectCard(props: ProjectCardProps) {
  const isLive = "id" in props
  const progress = isLive ? props.progressPercent : props.progress
  const statusTone = statusToneMap[props.status] ?? "bg-slate-100 text-slate-700"
  const href = isLive ? `/project-detail/${props.id}` : "/project-detail"

  return (
    <Card className="overflow-hidden border-border/70 bg-white/95 shadow-sm transition-transform duration-200 hover:-translate-y-1">
      <div className="h-1 bg-gradient-to-r from-teal-500 via-emerald-500 to-orange-400" />
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-semibold">{props.name}</CardTitle>
            <CardDescription>{isLive ? props.customerName : props.client}</CardDescription>
          </div>
          <Badge className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone}`}>{formatStatus(props.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pb-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{isLive ? props.location : props.stage}</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-teal-600" style={{ width: `${progress}%` }} />
          </div>
        </div>
        {isLive ? (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Budget used</span>
            <span className="font-medium text-foreground">
              {currency.format(props.spent)} / {currency.format(props.totalBudget)}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Budget</span>
            <span className="font-medium text-foreground">{props.budget}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>End date</span>
          <span className="font-medium text-foreground">{isLive ? dateFormat.format(new Date(props.estimatedEndDate)) : props.stage}</span>
        </div>
        <Link href={href} className={cn("inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:text-teal-900", isLive && "justify-end") }>
          Open details
          <ArrowRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
  )
}
