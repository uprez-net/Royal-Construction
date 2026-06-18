import { OfferStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  Hourglass,
  Send,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { OfferStatusLabels } from "@/types/offer";

const statusStyle: Record<OfferStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 border-yellow-300 ring-yellow-200",
  SENT: "bg-blue-100 text-blue-800 border-blue-300 ring-blue-200",
  ACCEPTED: "bg-green-100 text-green-800 border-green-300 ring-green-200",
  REJECTED: "bg-red-100 text-red-800 border-red-300 ring-red-200",
};

const StatusIcon: Record<OfferStatus, LucideIcon> = {
  PENDING: Hourglass,
  SENT: Send,
  ACCEPTED: CheckCircle,
  REJECTED: XCircle,
};

export function OfferStatusBadge({ status }: { status: OfferStatus }) {
  const IconComponent = StatusIcon[status];
  return (
    <Badge
      variant="outline"
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${statusStyle[status]}`}
    >
      <IconComponent className="mr-1 h-3 w-3" />
      {OfferStatusLabels[status]}
    </Badge>
  );
}
