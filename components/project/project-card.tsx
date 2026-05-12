import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function ProjectCard({
  name,
  client,
  status,
  progress,
  budget,
  stage,
}: {
  name: string
  client: string
  status: string
  progress: number
  budget: string
  stage: string
}) {
  const statusTone = status === "On Track" ? "bg-emerald-100 text-emerald-700" : status === "Pending Quote" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"

  return (
    <Card className="overflow-hidden border-border/70 bg-white/95 shadow-sm transition-transform duration-200 hover:-translate-y-1">
      <div className="h-1 bg-gradient-to-r from-teal-500 via-emerald-500 to-orange-400" />
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-semibold">{name}</CardTitle>
            <CardDescription>{client}</CardDescription>
          </div>
          <Badge className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone}`}>{status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pb-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{stage}</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-teal-600" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Budget</span>
          <span className="font-medium text-foreground">{budget}</span>
        </div>
        <Link href="/project-detail" className="inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:text-teal-900">
          Open details
          <ArrowRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
  )
}
