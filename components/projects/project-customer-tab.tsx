import type { ReactNode } from "react";
import { AlertTriangle, Check, Mail, MessageCircle, Phone } from "lucide-react";

import { ProjectWithStats } from "@/types/project";
import { ProjectRequirementsPayload } from "@/types/project-flow";
import { currency, dateFormat } from "@/utils/formatters";
import { Button } from "../ui/button";

interface CustomerTabProps {
  project: ProjectWithStats;
  isAdmin: boolean;
}

const NOT_RECORDED = "Not recorded";

function formatList(values?: string[]) {
  if (!values || values.length === 0) {
    return NOT_RECORDED;
  }

  return values.join(", ");
}

/** Formats a nullable money field, never emitting a bare "$" or a raw number. */
function formatMoneyField(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? currency.format(value)
    : NOT_RECORDED;
}

/** Formats a nullable date string, falling back to the raw value if unparseable. */
function formatDateField(value: string | null | undefined) {
  if (!value) return NOT_RECORDED;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormat.format(parsed);
}

/** Australian country calling code — numbers are stored in national format. */
const AU_COUNTRY_CODE = "61";

/**
 * wa.me only accepts a bare international subscriber number: digits only, no
 * `+`, no separators and no national trunk prefix. Feeding it the stored
 * national format ("0412 345 678") resolves to an invalid recipient, so the
 * link is only rendered once the number can be normalised with confidence.
 */
function toWhatsAppNumber(value: string): string | null {
  const trimmed = value.trim();
  const hasInternationalPrefix = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  // "0061…" is the dialled form of "+61…"; drop the international access code.
  const withoutAccessCode =
    !hasInternationalPrefix && digits.startsWith("00")
      ? digits.slice(2)
      : digits;

  let normalized: string;
  if (hasInternationalPrefix || withoutAccessCode !== digits) {
    // Already international — leave the country code alone.
    normalized = withoutAccessCode;
  } else if (withoutAccessCode.startsWith("0")) {
    // National format: swap the trunk "0" for the country code.
    normalized = `${AU_COUNTRY_CODE}${withoutAccessCode.slice(1)}`;
  } else if (withoutAccessCode.startsWith(AU_COUNTRY_CODE)) {
    normalized = withoutAccessCode;
  } else {
    // No trunk zero, no country code: guessing one would produce a link to the
    // wrong person, so drop the affordance instead.
    return null;
  }

  // E.164 allows 8–15 digits; outside that it is not a dialable number.
  return normalized.length >= 8 && normalized.length <= 15 ? normalized : null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-x-1.5">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

export function CustomerTab({ project, isAdmin }: CustomerTabProps) {
  const requirements = (project.requirements
    ?? {}) as ProjectRequirementsPayload;
  const ownerContacts = requirements.legalAdministration?.ownerContacts;
  const commercials = requirements.commercialsAndClaims;
  const inclusions = requirements.inclusionsAndExclusions?.inclusions ?? [];
  const exclusions = requirements.inclusionsAndExclusions?.exclusions ?? [];
  const hasRequirementFlags = inclusions.length > 0 || exclusions.length > 0;

  const phone = project.customer.phone?.trim();
  const email = project.customer.email?.trim();
  const telHref = phone ? `tel:${phone.replace(/\s+/g, "")}` : null;
  const whatsappNumber = phone ? toWhatsAppNumber(phone) : null;
  const whatsappHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber}`
    : null;
  const slabPercentage = commercials?.claimStageSlabPercentage;

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-muted p-4">
        <p className="text-base font-semibold text-foreground">
          {project.customer.name}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Client since{" "}
          <span className="font-mono tabular-nums">
            {dateFormat.format(new Date(project.customer.createdAt))}
          </span>{" "}
          · {project.buildingType}
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Phone">
          {phone && telHref ? (
            <a
              href={telHref}
              className="font-mono tabular-nums underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {phone}
            </a>
          ) : (
            <span className="text-muted-foreground">{NOT_RECORDED}</span>
          )}
        </Field>

        <Field label="Email">
          {email ? (
            <a
              href={`mailto:${email}`}
              className="break-all underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {email}
            </a>
          ) : (
            <span className="text-muted-foreground">{NOT_RECORDED}</span>
          )}
        </Field>

        <Field label="Site address">
          {requirements.legalAdministration?.siteAddress || project.location}
        </Field>

        {isAdmin && (
          <Field label="Project value">
            <span className="font-mono tabular-nums">
              {formatMoneyField(Number(project.totalBudget))}
            </span>
          </Field>
        )}

        <Field label="Signed date">
          <span className="font-mono tabular-nums">
            {formatDateField(requirements.legalAdministration?.signedDate)}
          </span>
        </Field>

        <Field label="PCA inspector">
          {requirements.legalAdministration?.pcaInspector || (
            <span className="text-muted-foreground">{NOT_RECORDED}</span>
          )}
        </Field>
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/4">
          <h3 className="text-base font-semibold text-foreground">
            Contract owner contacts
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <DetailRow label="Names">
              {formatList(ownerContacts?.names)}
            </DetailRow>
            <DetailRow label="Emails">
              {formatList(ownerContacts?.emails)}
            </DetailRow>
            <DetailRow label="Phones">
              <span className="font-mono tabular-nums">
                {formatList(ownerContacts?.phones)}
              </span>
            </DetailRow>
          </dl>
        </div>

        {isAdmin && (
          <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/4">
            <h3 className="text-base font-semibold text-foreground">
              Commercial snapshot
            </h3>
            <dl className="mt-3 space-y-2 text-sm">
              <DetailRow label="Total contract sum">
                <span className="font-mono tabular-nums">
                  {formatMoneyField(commercials?.totalContractSum)}
                </span>
              </DetailRow>
              <DetailRow label="Deposit">
                <span className="font-mono tabular-nums">
                  {formatMoneyField(commercials?.depositValue)}
                </span>
              </DetailRow>
              <DetailRow label="GST amount">
                <span className="font-mono tabular-nums">
                  {formatMoneyField(commercials?.gstAmount)}
                </span>
              </DetailRow>
              <DetailRow label="Slab claim stage">
                <span className="font-mono tabular-nums">
                  {typeof slabPercentage === "number"
                    ? `${slabPercentage}%`
                    : NOT_RECORDED}
                </span>
              </DetailRow>
            </dl>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold text-foreground">
          Requirements
        </h3>

        {hasRequirementFlags ? (
          <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/4 grid grid-cols-2 gap-4">
            <div className="col-span-2 md:col-span-1 space-y-3">
              <h5 className="text-sm font-medium text-foreground flex items-center">
                <Check
                  aria-hidden="true"
                  className="mr-1 h-3 w-3 shrink-0 text-success-ink"
                />
                Inclusions
              </h5>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 max-h-[30vh] overflow-y-auto no-scrollbar pr-1">
                {inclusions.map((item) => (
                  <li
                    key={`inclusion-${item}`}
                    className="inline-flex items-start gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground"
                  >
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 h-3 w-3 shrink-0 text-success-ink"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="col-span-2 md:col-span-1 space-y-3">
              <h5 className="text-sm font-medium text-foreground flex items-center">
                <AlertTriangle
                  aria-hidden="true"
                  className="mr-1 h-3 w-3 shrink-0 text-warning-ink"
                />
                Exclusions
              </h5>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 max-h-[30vh] overflow-y-auto no-scrollbar pr-1">
                {exclusions.map((item) => (
                  <li
                    key={`exclusion-${item}`}
                    className="inline-flex items-start gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground"
                  >
                    <AlertTriangle
                      aria-hidden="true"
                      className="mt-0.5 h-3 w-3 shrink-0 text-warning-ink"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No inclusions or exclusions have been captured from the contract
            yet.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {email ? (
          <Button asChild size="lg">
            <a href={`mailto:${email}`}>
              <Mail aria-hidden="true" />
              Email {project.customer.name}
            </a>
          </Button>
        ) : null}

        {telHref ? (
          <Button asChild variant="outline" size="lg">
            <a href={telHref}>
              <Phone aria-hidden="true" />
              Call
            </a>
          </Button>
        ) : null}

        {whatsappHref ? (
          <Button asChild variant="outline" size="lg">
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden="true" />
              WhatsApp
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
