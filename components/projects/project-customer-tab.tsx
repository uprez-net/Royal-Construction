import { ProjectWithStats } from "@/types/project";
import { ProjectRequirementsPayload } from "@/types/project-flow";
import { currency, dateFormat } from "@/utils/formatters";
import {
  Check,
  FileText,
  Info,
  Mail,
  MessageCircle,
  Phone,
} from "lucide-react";
import { Button } from "../ui/button";
import { toast } from "sonner";

interface CustomerTabProps {
  project: ProjectWithStats;
}

function formatList(values?: string[]) {
  if (!values || values.length === 0) {
    return "—";
  }

  return values.join(", ");
}

export function CustomerTab({ project }: CustomerTabProps) {
  const requirements = (project.requirements ??
    {}) as ProjectRequirementsPayload;
  const ownerContacts = requirements.legalAdministration?.ownerContacts;
  const ownerResponsibilities =
    requirements.exclusionsAndRisks?.ownerResponsibility ?? [];
  const variationRisks =
    requirements.exclusionsAndRisks?.variationRequired ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted p-4">
        <p className="mb-2 text-sm font-semibold text-foreground">
          {project.customer.name}
        </p>
        <p className="text-xs text-muted-foreground">
          Client since {dateFormat.format(new Date(project.customer.createdAt))}{" "}
          - {project.buildingType}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Phone</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {project.customer.phone || "—"}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">Email</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {project.customer.email || "—"}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Site Address
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {requirements.legalAdministration?.siteAddress || project.location}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Project Value
          </p>
          <p className="mt-1 text-sm font-semibold text-emerald-600">
            {currency.format(Number(project.totalBudget))}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Signed Date
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {requirements.legalAdministration?.signedDate || "—"}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">
            PCA Inspector
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {requirements.legalAdministration?.pcaInspector || "—"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Owner Contacts
          </p>
          <div className="mt-3 space-y-2 text-sm text-foreground">
            <div>
              <span className="font-semibold">Names: </span>
              {formatList(ownerContacts?.names)}
            </div>
            <div>
              <span className="font-semibold">Emails: </span>
              {formatList(ownerContacts?.emails)}
            </div>
            <div>
              <span className="font-semibold">Phones: </span>
              {formatList(ownerContacts?.phones)}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Commercial Snapshot
          </p>
          <div className="mt-3 space-y-2 text-sm text-foreground">
            <div>
              <span className="font-semibold">Contract Price: </span>
              {requirements.commercialsAndClaims?.contractPrice ?? "—"}
            </div>
            <div>
              <span className="font-semibold">Deposit: </span>
              {requirements.commercialsAndClaims?.depositValue ?? "—"}
            </div>
            <div>
              <span className="font-semibold">GST Amount: </span>
              {requirements.commercialsAndClaims?.gstAmount ?? "—"}
            </div>
            <div>
              <span className="font-semibold">Claim Stage Slab: </span>
              {requirements.commercialsAndClaims?.claimStageSlabPercentage ??
                "—"}
              %
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium text-muted-foreground">
          Customer Requirements
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {ownerResponsibilities.length > 0 || variationRisks.length > 0 ? (
            <>
              {ownerResponsibilities.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center gap-2 rounded-lg bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground"
                >
                  <Check className="h-3 w-3 text-green-500" />
                  Owner responsibility: {item}
                </span>
              ))}
              {variationRisks.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center gap-2 rounded-lg bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground"
                >
                  <Check className="h-3 w-3 text-amber-500" />
                  Variation risk: {item}
                </span>
              ))}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              No structured requirement flags captured yet.
            </span>
          )}
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-teal-600/10 bg-emerald-50 px-4 py-3.5">
        <div className="mb-1.5 flex items-center gap-1 text-xs font-bold text-emerald-700">
          <Info className="h-3.5 w-3.5" />
          <span>Portfolio Notes</span>
        </div>

        <p className="m-0 text-[13px] leading-6 text-(--text-secondary)">
          Client has been provided the Royal Constructions platform link for
          requirement submission. All selections from catalogue have been
          recorded.
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
          onClick={() => toast.info(`Calling ${project.customer.phone}...`)}
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
