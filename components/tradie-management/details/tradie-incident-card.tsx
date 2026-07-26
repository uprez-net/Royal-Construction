import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  LucideIcon,
  ShieldAlert,
  ShieldCheckIcon,
  Wrench,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { dateFormat, formatStatus } from "@/utils/formatters";
import { useAppSelector } from "@/lib/store/hooks";
import { cn } from "@/lib/utils";

type IncidentType =
  | "SAFETY"
  | "QUALITY"
  | "BEHAVIOUR"
  | "ATTENDANCE"
  | "DAMAGE"
  | "OTHER";

/**
 * Colour encodes severity — the only dimension here that varies in urgency —
 * using the three-role status tokens (fill for the dot, `-light` surface plus
 * `-ink` text for the chip). Incident *type* is carried by its lucide glyph and
 * its text label, never by colour, so two incidents of different type but equal
 * severity read as equally urgent.
 */
const severityConfig = {
  LOW: {
    dot: "bg-info",
    chip: "border-transparent bg-info-light text-info-ink",
  },
  MEDIUM: {
    dot: "bg-warning",
    chip: "border-transparent bg-warning-light text-warning-ink",
  },
  HIGH: {
    dot: "bg-destructive",
    chip: "border-transparent bg-destructive-light text-destructive-ink",
  },
  CRITICAL: {
    dot: "bg-destructive",
    chip: "border-transparent bg-destructive text-destructive-foreground",
  },
} as const;

const typeConfig: Record<IncidentType, { label: string; icon: LucideIcon }> = {
  SAFETY: { label: "Safety", icon: ShieldAlert },
  QUALITY: { label: "Quality", icon: AlertCircle },
  BEHAVIOUR: { label: "Behaviour", icon: AlertTriangle },
  ATTENDANCE: { label: "Attendance", icon: CalendarDays },
  DAMAGE: { label: "Damage", icon: Wrench },
  OTHER: { label: "Other", icon: AlertCircle },
};

export function TradieIncidentsCard() {
  const tradieDetails = useAppSelector(
    (state) => state.tradieManagement.selectedTradieDetails,
  );

  if (!tradieDetails) {
    return null;
  }

  // Open incidents are what an operator has to act on, so they surface first;
  // within each group the most recent comes first.
  const incidents = [...tradieDetails.incidents].sort((a, b) => {
    const aOpen = a.status === "OPEN" ? 0 : 1;
    const bOpen = b.status === "OPEN" ? 0 : 1;

    if (aOpen !== bOpen) {
      return aOpen - bOpen;
    }

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const openCount = incidents.filter(
    (incident) => incident.status === "OPEN",
  ).length;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle as="h2">
          Incidents ({incidents.length}
          {openCount > 0 ? `, ${openCount} open` : ""})
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {incidents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 pb-8 pt-2 text-sm text-muted-foreground">
            <ShieldCheckIcon className="size-10" aria-hidden="true" />
            No incidents reported
          </div>
        ) : (
          <ScrollArea className="max-h-100 px-6 pb-6">
            <div className="space-y-4">
              {incidents.map((incident) => {
                const type =
                  typeConfig[incident.type as IncidentType] ?? typeConfig.OTHER;
                const TypeIcon = type.icon;
                // Unmapped severities used to throw here and take the whole page
                // down via the error boundary.
                const severity =
                  severityConfig[
                    incident.severity as keyof typeof severityConfig
                  ] ?? severityConfig.MEDIUM;
                const isOpen = incident.status === "OPEN";

                return (
                  <div
                    key={incident.id}
                    className="rounded-lg border border-border/70 p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className="gap-1 border-border/70 bg-muted text-foreground"
                      >
                        <TypeIcon className="h-3 w-3" aria-hidden="true" />
                        {type.label}
                      </Badge>

                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                          severity.chip,
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            severity.dot,
                          )}
                          aria-hidden="true"
                        />
                        {formatStatus(incident.severity)} severity
                      </span>

                      <Badge variant={isOpen ? "destructive" : "secondary"}>
                        {formatStatus(incident.status)}
                      </Badge>
                    </div>

                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {incident.description}
                    </p>

                    <div className="mt-3 text-xs text-muted-foreground">
                      Reported on{" "}
                      <span className="font-mono tabular-nums">
                        {dateFormat.format(incident.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
