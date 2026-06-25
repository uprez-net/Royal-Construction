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
import { dateFormat } from "@/utils/formatters";
import { useAppSelector } from "@/lib/store/hooks";

type IncidentType =
  | "SAFETY"
  | "QUALITY"
  | "BEHAVIOUR"
  | "ATTENDANCE"
  | "DAMAGE"
  | "OTHER";

const severityConfig = {
  LOW: {
    color: "bg-emerald-500",
  },
  MEDIUM: {
    color: "bg-amber-500",
  },
  HIGH: {
    color: "bg-orange-500",
  },
  CRITICAL: {
    color: "bg-red-500",
  },
};

const typeConfig: Record<
  IncidentType,
  { label: string; icon: LucideIcon; className: string }
> = {
  SAFETY: {
    label: "Safety",
    icon: ShieldAlert,
    className: "bg-red-100 text-red-700 border-red-200",
  },
  QUALITY: {
    label: "Quality",
    icon: AlertCircle,
    className: "bg-blue-100 text-blue-700 border-blue-200",
  },
  BEHAVIOUR: {
    label: "Behaviour",
    icon: AlertTriangle,
    className: "bg-amber-100 text-amber-700 border-amber-200",
  },
  ATTENDANCE: {
    label: "Attendance",
    icon: CalendarDays,
    className: "bg-green-100 text-green-700 border-green-200",
  },
  DAMAGE: {
    label: "Damage",
    icon: Wrench,
    className: "bg-yellow-100 text-yellow-700 border-yellow-200",
  },
  OTHER: {
    label: "Other",
    icon: AlertCircle,
    className: "bg-gray-100 text-gray-700 border-gray-200",
  },
};

export function TradieIncidentsCard() {
  const tradieDetails = useAppSelector(
    (state) => state.tradieManagement.selectedTradieDetails,
  );

  if (!tradieDetails) {
    return null;
  }

  const { incidents } = tradieDetails;

  return (
    <Card className="h-100">
      <CardHeader className="pb-4">
        <CardTitle>Incidents ({incidents.length})</CardTitle>
      </CardHeader>

      <CardContent className="h-80 p-0">
        <ScrollArea className="h-full px-6 pb-6">
          <div className="space-y-4">
            {incidents.length === 0 ? (
              <div className="flex flex-col h-80 items-center justify-center text-sm text-muted-foreground gap-3">
                <ShieldCheckIcon className="size-10" />
                No incidents reported
              </div>
            ) : (
              incidents.map((incident) => {
                const type =
                  typeConfig[incident.type as IncidentType] ?? typeConfig.OTHER;
                const TypeIcon = type.icon;

                return (
                  <div key={incident.id} className="rounded-lg border p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={type.className}>
                        <TypeIcon className="mr-1 h-3 w-3" />
                        {type.label}
                      </Badge>

                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          severityConfig[incident.severity].color
                        }`}
                      />

                      <span className="text-xs font-semibold uppercase">
                        {incident.severity}
                      </span>

                      <Badge
                        variant={
                          incident.status === "OPEN"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {incident.status}
                      </Badge>
                    </div>

                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {incident.description}
                    </p>

                    <div className="mt-3 text-xs text-muted-foreground">
                      Reported on{" "}
                      <span className="font-medium">
                        {dateFormat.format(incident.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
