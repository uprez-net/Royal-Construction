import { ProjectWithStats } from "@/types/project";
import { currency, dateFormat } from "@/utils/formatters";
import { Check, FileText, Info, Mail, MessageCircle, Phone } from "lucide-react";
import { Button } from "../ui/button";
import { toast } from "sonner";

interface CustomerTabProps {
  project: ProjectWithStats;
}
export function CustomerTab({ project }: CustomerTabProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted p-4">
        <p className="text-sm font-semibold text-foreground mb-2">
          {project.customer.name}
        </p>
        <p className="text-xs text-muted-foreground">
          Client since {dateFormat.format(new Date(project.customer.createdAt))}{" "}
          - {project.buildingType}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground font-medium">Phone</p>
          <p className="text-sm font-semibold text-foreground mt-1">
            {project.customer.phone || "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">Email</p>
          <p className="text-sm font-semibold text-foreground mt-1">
            {project.customer.email || "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">
            Site Address
          </p>
          <p className="text-sm font-semibold text-foreground mt-1">
            {project.location}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">
            Project Value
          </p>
          <p className="text-sm font-semibold text-emerald-600 mt-1">
            {currency.format(Number(project.totalBudget))}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs text-muted-foreground font-medium">
          Customer Requirements ({(project.requirements as string[]).length})
        </p>
        <div className="flex gap-2 flex-wrap mt-4">
          {((project.requirements ?? []) as string[]).map((req, index) => (
            <span
              key={index}
              className="inline-flex items-center rounded-[4px] bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground gap-2"
            >
              <Check className="text-green-500 h-3 w-3" />
              {req}
            </span>
          ))}
        </div>
      </div>

      <div className="mb-4 rounded-[10px] border border-teal-600/10 bg-emerald-50 px-[18px] py-[14px]">
        <div className="mb-1.5 flex items-center gap-1 text-xs font-bold text-emerald-700">
          <Info className="h-3.5 w-3.5" />
          <span>Portfolio Notes</span>
        </div>

        <p className="m-0 text-[13px] leading-6 text-[var(--text-secondary)]">
          Client has been provided the Royal Constructions platform link for requirement
          submission. All selections from catalogue have been recorded.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => toast.info("Opening email composer...")}
          className="gap-1.5"
        >
          <Mail className="h-4 w-4" />
          Send Email
        </Button>

        <Button
          variant="outline"
          onClick={() => toast.info(`Calling ${project.customer}...`)}
          className="gap-1.5"
        >
          <Phone className="h-4 w-4" />
          Call Now
        </Button>

        <Button
          variant="outline"
          onClick={() => toast.success("Opening WhatsApp...")}
          className="gap-1.5"
        >
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </Button>

        <Button
          variant="outline"
          onClick={() => toast.info("Generating portfolio PDF...")}
          className="gap-1.5"
        >
          <FileText className="h-4 w-4" />
          Export Portfolio
        </Button>
      </div>
    </div>
  );
}
