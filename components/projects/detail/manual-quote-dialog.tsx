"use client";

import type { TradieQuoteGst } from "@prisma/client";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getTradieGroupedByCategoryCached } from "@/lib/data/tradie-management";
import { bookingTrade, sameTrade } from "@/lib/domain/tradies/request-rules";
import { quoteEntryFor } from "@/lib/domain/tradies/selection-rules";
import { useAppDispatch } from "@/lib/store/hooks";
import { recordManualQuote } from "@/lib/store/slices/projectsSlice";
import { PROJECT_STAGE_LABELS, type ProjectDetail } from "@/types/project";
import { currency } from "@/utils/formatters";

import { isActiveSchedule, requestableActivities } from "./tradie-requests";

const GST_OPTIONS: { value: TradieQuoteGst; label: string }[] = [
  { label: "Includes GST", value: "INCLUSIVE" },
  { label: "Excludes GST", value: "EXCLUSIVE" },
  { label: "Not registered for GST", value: "NOT_REGISTERED" },
];

/**
 * Record a quote that arrived by phone, on paper or as a PDF handed over on
 * site — one amount per activity, because milestone spend is counted per
 * booking. A tradie who was never sent a request gets a booking made for them.
 *
 * Also how a tradie booked directly gets their price: the amount lands on the
 * booking and the booking stays where it is (`quoteEntryFor`).
 */
export function ManualQuoteDialog({
  open,
  onOpenChange,
  project,
  trade,
  initialTradieId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectDetail;
  trade: string;
  /** Opens on this tradie, e.g. the one just booked. */
  initialTradieId?: string | null;
}) {
  const dispatch = useAppDispatch();
  const [directory, setDirectory] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [tradieId, setTradieId] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [gst, setGst] = useState<TradieQuoteGst | "">("");
  const [quotedAt, setQuotedAt] = useState(() =>
    format(new Date(), "yyyy-MM-dd"),
  );
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Each opening starts on the tradie it was opened for. Adjusted while
  // rendering, on the change of `open`, rather than in an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTradieId(initialTradieId ?? "");
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getTradieGroupedByCategoryCached()
      .then((groups) => {
        if (cancelled) return;
        setDirectory(
          groups
            .filter((group) => sameTrade(group.category, trade))
            .flatMap((group) => group.tradies)
            .map((tradie) => ({ id: tradie.id, name: tradie.name })),
        );
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load the tradie directory.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, trade]);

  // Tradies already on the project in this trade come first; the directory
  // adds anyone not asked yet.
  const tradieOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const schedule of project.tradieSchedules) {
      if (sameTrade(bookingTrade(schedule), trade)) {
        seen.set(schedule.tradieId, schedule.tradie.name);
      }
    }
    for (const tradie of directory) {
      if (!seen.has(tradie.id)) seen.set(tradie.id, tradie.name);
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [directory, project.tradieSchedules, trade]);

  // The trade's open activities, plus any this tradie is booked on.
  const activities = useMemo(() => {
    const open = requestableActivities(project.milestones, { trade });
    const booked = project.milestones.filter(
      (milestone) =>
        !open.some((item) => item.id === milestone.id)
        && project.tradieSchedules.some(
          (schedule) =>
            schedule.tradieId === tradieId
            && schedule.milestoneId === milestone.id
            && sameTrade(bookingTrade(schedule), trade)
            && isActiveSchedule(schedule.status),
        ),
    );
    return [...open, ...booked].map((milestone) => {
      // This trade's booking only, the same one the command will price.
      const booking = project.tradieSchedules.find(
        (schedule) =>
          schedule.tradieId === tradieId
          && schedule.milestoneId === milestone.id
          && sameTrade(bookingTrade(schedule), trade)
          && isActiveSchedule(schedule.status),
      );
      // The same rule the command applies: a quote booking moves to "quote
      // received", a direct booking keeps its status, and an approved price
      // is the admin's to change, not this form's.
      const entry = booking
        ? quoteEntryFor({
            quotedPrice: booking.quotedPrice,
            requestKind: booking.requestRecipient?.request.kind ?? null,
            requiresQuote: booking.requiresQuote,
            status: booking.status,
          })
        : "quote";
      return {
        id: milestone.id,
        locked: entry === "locked",
        priceOnly: entry === "price",
        name: milestone.name,
        stage: PROJECT_STAGE_LABELS[milestone.projectStage],
      };
    });
  }, [project.milestones, project.tradieSchedules, trade, tradieId]);

  const lines = activities
    .filter((activity) => !activity.locked && amounts[activity.id]?.trim())
    .map((activity) => ({
      amount: Number(amounts[activity.id]),
      milestoneId: activity.id,
    }));
  const total = lines.reduce(
    (sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0),
    0,
  );

  const reset = () => {
    setTradieId("");
    setAmounts({});
    setGst("");
    setQuotedAt(format(new Date(), "yyyy-MM-dd"));
    setValidUntil("");
    setNotes("");
    setError(null);
  };

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    if (busy) return;
    if (!tradieId) return setError("Choose the tradie who quoted.");
    if (lines.length === 0)
      return setError("Add an amount for at least one activity.");
    if (lines.some((line) => !Number.isFinite(line.amount) || line.amount <= 0))
      return setError("Every amount must be more than $0.");
    if (!gst) return setError("Say how the quote treats GST.");
    setError(null);
    setBusy(true);
    try {
      const result = await dispatch(
        recordManualQuote({
          gstTreatment: gst,
          lines,
          notes: notes.trim() || undefined,
          projectId: project.id,
          quotedAt,
          trade,
          tradieId,
          validUntil: validUntil || undefined,
        }),
      ).unwrap();
      toast.success(
        `Quote recorded for ${result.tradieName} across ${result.activityCount} ${result.activityCount === 1 ? "activity" : "activities"}.`,
      );
      reset();
      onOpenChange(false);
    } catch (caught) {
      setError(
        typeof caught === "string" ? caught : "The quote could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        data-mobile-scroll="body"
        className="max-h-[calc(100dvh-1.5rem)] max-w-2xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Manual {trade} quote</DialogTitle>
          <DialogDescription>
            For a quote that did not come by email, or the price of a tradie you
            booked directly. Enter what the tradie priced each activity at;
            leave the rest blank.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="manual-quote-tradie">Tradie</Label>
            <Select
              value={tradieId}
              onValueChange={(value) => {
                setTradieId(value);
                setAmounts({});
                setError(null);
              }}
            >
              <SelectTrigger id="manual-quote-tradie" className="w-full">
                <SelectValue placeholder={`Choose a ${trade} tradie`} />
              </SelectTrigger>
              <SelectContent>
                {tradieOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {tradieId ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">
                Amount per activity
              </legend>
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No open activities need {trade}.
                </p>
              ) : (
                activities.map((activity) => (
                  <div
                    key={activity.id}
                    className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3"
                  >
                    <Label
                      htmlFor={`manual-quote-${activity.id}`}
                      className="min-w-0 flex-col items-start gap-0 font-normal"
                    >
                      <span className="block truncate text-sm text-foreground">
                        {activity.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {activity.locked
                          ? "Already approved; its price cannot change here"
                          : activity.priceOnly
                            ? `${activity.stage} · booked directly; the booking stays as it is`
                            : activity.stage}
                      </span>
                    </Label>
                    <Input
                      id={`manual-quote-${activity.id}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      placeholder="$0.00"
                      className="font-mono"
                      disabled={activity.locked}
                      value={amounts[activity.id] ?? ""}
                      onChange={(event) =>
                        setAmounts((previous) => ({
                          ...previous,
                          [activity.id]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ))
              )}
              <p className="text-right text-xs text-muted-foreground">
                Total{" "}
                <span className="font-mono text-sm font-medium text-foreground">
                  {currency.format(total)}
                </span>
              </p>
            </fieldset>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="manual-quote-gst">GST</Label>
              <Select
                value={gst}
                onValueChange={(value) => setGst(value as TradieQuoteGst)}
              >
                <SelectTrigger id="manual-quote-gst" className="w-full">
                  <SelectValue placeholder="How is GST treated?" />
                </SelectTrigger>
                <SelectContent>
                  {GST_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-quote-date">Quote date</Label>
              <Input
                id="manual-quote-date"
                type="date"
                value={quotedAt}
                onChange={(event) => setQuotedAt(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-quote-valid">Valid until (optional)</Label>
              <Input
                id="manual-quote-valid"
                type="date"
                min={quotedAt}
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-quote-notes">Notes (optional)</Label>
            <Textarea
              id="manual-quote-notes"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Inclusions, exclusions, how it was received…"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="text-sm font-medium text-destructive-ink"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => close(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} aria-busy={busy}>
            {busy ? (
              <Loader2
                className="mr-1.5 size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : null}
            {busy ? "Saving…" : "Record quote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
