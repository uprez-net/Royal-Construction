"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  FilePlus2,
  Loader2,
  Send,
} from "lucide-react";
import { useMemo, useState, type SubmitEvent } from "react";
import { toast } from "sonner";

import { EmailPreviewFrame } from "@/components/common/email-preview-frame";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchVariationOptions,
  previewVariationAction,
  raiseVariationAction,
  type VariationPreviewResult,
} from "@/lib/data/variation-actions";
import { sydneyToday } from "@/lib/dates/sydney";
import type { VariationActivityOption } from "@/lib/domain/projects/variation-raise";
import { variationCharge } from "@/lib/domain/projects/variation-rules";
import { cn } from "@/lib/utils";
import { PROJECT_STAGE_LABELS } from "@/types/project";

const MONEY = new Intl.NumberFormat("en-AU", {
  currency: "AUD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const money = (cents: number) => MONEY.format(cents / 100);

/** Dollars typed into a field, as whole cents; null when it is not a number. */
function cents(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

const STEPS = ["Details", "Document", "Email & send"] as const;

type Preview = Extract<VariationPreviewResult, { ok: true }>;

export type CreateVariationModalProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a variation was written, whether or not every step landed. */
  onSuccess?: () => void;
  /** Opened from an activity's row: start on that activity. */
  initialMilestoneId?: string | null;
};

/**
 * Raise a variation: reprice one activity, preview the document the client
 * will receive, then send it — raising the Xero invoice first when the client
 * pays.
 *
 * Opened from the Financials, Milestones and Variations tabs. It brings its
 * own QueryClient, as the Financials tab does, so it works wherever it is
 * mounted.
 */
export function CreateVariationModal(props: CreateVariationModalProps) {
  const [queryClient] = useState(() => new QueryClient());
  if (!props.open) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <VariationWizard {...props} />
    </QueryClientProvider>
  );
}

function VariationWizard({
  projectId,
  open,
  onOpenChange,
  onSuccess,
  initialMilestoneId,
}: CreateVariationModalProps) {
  const options = useQuery({
    queryKey: ["variation-options", projectId],
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async () => {
      const result = await fetchVariationOptions(projectId);
      if (!result.ok) throw new Error(result.error);
      return result.options;
    },
  });

  const [step, setStep] = useState(0);
  const [milestoneId, setMilestoneId] = useState(initialMilestoneId ?? "");
  const [newPrice, setNewPrice] = useState("");
  const [promotional, setPromotional] = useState(false);
  const [reason, setReason] = useState("");
  const [raisedDate, setRaisedDate] = useState(() => sydneyToday());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [recipients, setRecipients] = useState<ReadonlySet<string> | null>(
    null,
  );
  // One key per opening of the wizard: a double-click or a retry after a
  // timeout returns the variation already raised instead of a second invoice.
  const [requestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    message: string;
    field?: string;
  } | null>(null);

  const activity = options.data?.activities.find(
    (option) => option.id === milestoneId,
  );
  const newPriceCents = cents(newPrice);
  const kind = promotional ? "PROMOTIONAL" : "CHARGEABLE";
  const charge =
    activity && newPriceCents !== null
      ? variationCharge({
          kind,
          newPriceCents,
          previousPriceCents: activity.currentPriceCents,
        })
      : null;

  const byStage = useMemo(() => {
    const groups = new Map<string, VariationActivityOption[]>();
    for (const option of options.data?.activities ?? []) {
      const label = PROJECT_STAGE_LABELS[option.stage];
      groups.set(label, [...(groups.get(label) ?? []), option]);
    }
    return [...groups];
  }, [options.data]);

  const chosenRecipients =
    recipients ?? new Set(preview?.recipients.map((r) => r.email) ?? []);

  function draft() {
    return {
      kind,
      milestoneId,
      newPrice: newPriceCents === null ? Number.NaN : newPriceCents / 100,
      projectId,
      raisedDate,
      reason,
    } as const;
  }

  async function toDocument(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!milestoneId) {
      setError({ field: "milestoneId", message: "Choose the activity." });
      return;
    }
    if (newPriceCents === null) {
      setError({ field: "newPrice", message: "Enter the new price." });
      return;
    }
    if (!reason.trim()) {
      setError({
        field: "reason",
        message: "Say why the price is changing. The client reads this.",
      });
      return;
    }
    setBusy(true);
    try {
      const result = await previewVariationAction(draft());
      if (!result.ok) {
        setError({ field: result.field, message: result.error });
        return;
      }
      setPreview(result);
      setRecipients(null);
      setStep(1);
    } catch {
      setError({ message: "The preview could not be prepared. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (busy || !preview) return;
    setError(null);
    if (chosenRecipients.size === 0) {
      setError({ field: "recipients", message: "Choose who to email." });
      return;
    }
    setBusy(true);
    try {
      const result = await raiseVariationAction({
        ...draft(),
        recipients: [...chosenRecipients],
        requestKey,
      });
      if (result.ok) {
        const { issued } = result;
        toast.success(
          `Variation ${issued.number} sent${issued.emailedTo.length ? ` to ${issued.emailedTo.join(", ")}` : ""}.`,
          {
            description: issued.invoiceNumber
              ? `Xero invoice ${issued.invoiceNumber} raised.`
              : promotional
                ? "Promotional: no Xero invoice raised."
                : undefined,
          },
        );
        onSuccess?.();
        onOpenChange(false);
        return;
      }
      if ("variationId" in result && result.variationId) {
        // Written, but a step after it failed: the tab shows it with a retry.
        toast.error("The variation was saved, but not everything went out.", {
          description: result.error,
          duration: 12_000,
        });
        onSuccess?.();
        onOpenChange(false);
        return;
      }
      setError({ field: result.field, message: result.error });
      if (result.field && result.field !== "recipients") setStep(0);
    } catch {
      setError({
        message:
          "The variation could not be sent. Check the Variations tab before trying again, in case it went through.",
      });
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (field: string) =>
    error?.field === field ? "variation-wizard-error" : undefined;

  const errorNote = error ? (
    <p
      id="variation-wizard-error"
      role="alert"
      className="flex items-start gap-2 rounded-md bg-destructive-light px-3 py-2 text-sm font-medium text-destructive-ink"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {error.message}
    </p>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            Create variation
            {options.data ? (
              <span className="font-mono text-sm font-normal text-muted-foreground">
                {options.data.nextNumber}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            Reprice an activity, check the document the client will receive,
            then send it.
          </DialogDescription>
        </DialogHeader>

        <ol
          className="flex flex-wrap items-center gap-2 text-sm"
          aria-label="Steps"
        >
          {STEPS.map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-current={index === step ? "step" : undefined}
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full border text-xs font-medium",
                  index < step
                    && "border-primary bg-primary text-primary-foreground",
                  index === step && "border-primary text-primary",
                  index > step && "border-border text-muted-foreground",
                )}
              >
                {index < step ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  index === step
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              {index < STEPS.length - 1 ? (
                <span className="mx-1 h-px w-6 bg-border" aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ol>

        {step === 0 ? (
          options.isPending ? (
            <div
              className="space-y-3"
              role="status"
              aria-label="Loading activities"
            >
              <Skeleton className="h-9 w-full" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
              <Skeleton className="h-24 w-full" />
            </div>
          ) : options.isError ? (
            <p role="alert" className="text-sm text-destructive-ink">
              {options.error.message}
            </p>
          ) : (
            <form onSubmit={toDocument} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="variation-activity">Activity</Label>
                <Select
                  value={milestoneId}
                  onValueChange={(value) => {
                    setMilestoneId(value);
                    setPreview(null);
                  }}
                >
                  <SelectTrigger
                    id="variation-activity"
                    className="w-full"
                    aria-describedby={fieldError("milestoneId")}
                  >
                    <SelectValue placeholder="Choose the activity this reprices" />
                  </SelectTrigger>
                  <SelectContent>
                    {byStage.map(([stage, activities]) => (
                      <SelectGroup key={stage}>
                        <SelectLabel>{stage}</SelectLabel>
                        {activities.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            <span className="truncate">{option.path}</span>
                            <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">
                              {money(option.currentPriceCents)}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    Current price
                  </span>
                  <p className="flex h-9 items-center rounded-md border border-dashed border-border px-3 font-mono text-sm tabular-nums text-muted-foreground">
                    {activity
                      ? `${money(activity.currentPriceCents)} ex GST`
                      : "—"}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="variation-new-price">
                    New price (ex GST)
                  </Label>
                  <Input
                    id="variation-new-price"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={newPrice}
                    onChange={(event) => setNewPrice(event.target.value)}
                    aria-describedby={
                      fieldError("newPrice") ?? "variation-charge"
                    }
                    aria-invalid={error?.field === "newPrice" || undefined}
                  />
                </div>
              </div>

              <label
                htmlFor="variation-promotional"
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  promotional
                    ? "border-destructive/40 bg-destructive-light/50"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <Checkbox
                  id="variation-promotional"
                  checked={promotional}
                  onCheckedChange={(checked) =>
                    setPromotional(checked === true)
                  }
                  className="mt-0.5"
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium text-foreground">
                    Promotional — Royal Constructions covers this cost
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    The client sees the new price but pays nothing: their total
                    is $0.00 and no Xero invoice is raised.
                  </span>
                </span>
              </label>

              <p
                id="variation-charge"
                className={cn(
                  "rounded-md px-3 py-2 text-sm",
                  !charge
                    ? "bg-muted/50 text-muted-foreground"
                    : charge.differenceCents <= 0
                      ? "bg-warning-light text-warning-ink"
                      : promotional
                        ? "bg-destructive-light text-destructive-ink"
                        : "bg-success-light text-success-ink",
                )}
              >
                {!charge ? (
                  "Choose an activity and enter its new price to see what the client pays."
                ) : charge.differenceCents <= 0 ? (
                  "The new price must be more than the current price."
                ) : promotional ? (
                  <>
                    Royal Constructions absorbs{" "}
                    <span className="font-mono tabular-nums">
                      {money(charge.absorbedCents)}
                    </span>{" "}
                    ex GST. The client pays nothing.
                  </>
                ) : (
                  <>
                    The client is invoiced{" "}
                    <span className="font-mono tabular-nums">
                      {money(charge.chargeExGstCents)}
                    </span>{" "}
                    + GST{" "}
                    <span className="font-mono tabular-nums">
                      {money(charge.gstCents)}
                    </span>{" "}
                    ={" "}
                    <span className="font-mono font-semibold tabular-nums">
                      {money(charge.chargeIncGstCents)}
                    </span>{" "}
                    through Xero.
                  </>
                )}
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="variation-reason">
                  Reason for this variation
                </Label>
                <Textarea
                  id="variation-reason"
                  rows={4}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="What changed, and why. This is printed on the client's document."
                  aria-describedby={fieldError("reason")}
                  aria-invalid={error?.field === "reason" || undefined}
                />
              </div>

              <div className="space-y-1.5 sm:w-56">
                <Label htmlFor="variation-date">Date raised</Label>
                <Input
                  id="variation-date"
                  type="date"
                  value={raisedDate}
                  max={sydneyToday()}
                  onChange={(event) => setRaisedDate(event.target.value)}
                  aria-describedby={fieldError("raisedDate")}
                />
              </div>

              {errorNote}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  Preview document
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </DialogFooter>
            </form>
          )
        ) : null}

        {step === 1 && preview ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This is the PDF the client receives
              {promotional
                ? ""
                : ". The Xero invoice number is added when it is raised"}
              .
            </p>
            <div className="rounded-lg border border-border bg-muted/30 p-2">
              <EmailPreviewFrame
                html={preview.documentHtml}
                title="Variation document preview"
                editable={false}
                maxHeight={620}
                minScale={0.4}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(0)}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back
              </Button>
              <Button type="button" onClick={() => setStep(2)}>
                Continue to email
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {step === 2 && preview ? (
          <div className="space-y-4">
            <fieldset
              className="space-y-2"
              aria-describedby={fieldError("recipients")}
            >
              <legend className="text-sm font-medium text-foreground">
                Send to
              </legend>
              {preview.recipients.length === 0 ? (
                <p className="text-sm text-destructive-ink">
                  No owner on this contract has an email address. Add one on the
                  Overview tab first.
                </p>
              ) : (
                preview.recipients.map((recipient) => {
                  const checked = chosenRecipients.has(recipient.email);
                  return (
                    <label
                      key={recipient.email}
                      className="flex cursor-pointer items-center gap-3 text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => {
                          const updated = new Set(chosenRecipients);
                          if (next === true) updated.add(recipient.email);
                          else updated.delete(recipient.email);
                          setRecipients(updated);
                        }}
                      />
                      <span className="font-medium text-foreground">
                        {recipient.name}
                      </span>
                      <span className="text-muted-foreground">
                        {recipient.email}
                      </span>
                    </label>
                  );
                })
              )}
            </fieldset>
            <div className="text-sm">
              <span className="text-muted-foreground">Subject </span>
              <span className="font-medium text-foreground">
                {preview.subject}
              </span>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-2">
              <EmailPreviewFrame
                html={preview.emailHtml}
                title="Variation email preview"
                editable={false}
                maxHeight={480}
              />
            </div>
            <ul className="space-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              <li>
                {promotional
                  ? "No Xero invoice: this variation is promotional."
                  : `A Xero invoice for ${money(preview.chargeIncGstCents)} inc GST is raised first.`}
              </li>
              <li>
                The PDF is saved on the project and attached to the email.
              </li>
            </ul>
            {errorNote}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                disabled={busy}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back
              </Button>
              <Button
                type="button"
                onClick={() => void send()}
                disabled={busy || chosenRecipients.size === 0}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                {promotional ? "Send variation" : "Raise invoice and send"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
