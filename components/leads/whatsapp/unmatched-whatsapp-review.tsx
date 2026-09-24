"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Inbox, Loader2, Search } from "lucide-react";

import { ModalShell } from "@/components/common/modal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLeadSearch } from "@/hooks/useLeadSearch";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import {
  fetchUnmatchedWhatsApp,
  reviewUnmatchedWhatsApp,
} from "@/lib/leads/whatsapp-service";
import { formatSydneyStamp } from "@/lib/leads/whatsapp-format";
import type {
  WhatsAppUnmatchedDto,
  WhatsAppUnmatchedListDto,
} from "@/lib/leads/whatsapp-types";
import { cn } from "@/lib/utils";

const REASON_LABELS: Record<WhatsAppUnmatchedDto["reason"], string> = {
  AMBIGUOUS: "More than one lead has this number",
  NO_MATCH: "No lead has this number",
  UNKNOWN_BUSINESS_NUMBER: "Sent to a number this app isn't configured for",
};

/**
 * The way into the unmatched WhatsApp queue from the leads page (issue #333):
 * inbound messages from a number no single lead owns wait here for a person,
 * rather than being dropped or attached to the nearest lead.
 */
export function UnmatchedWhatsAppButton() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<number | null>(null);

  const loadCount = useCallback((signal?: AbortSignal) => {
    fetchUnmatchedWhatsApp(signal)
      .then((list) => setPending(list.pendingCount))
      .catch(() => {
        if (!signal?.aborted) setPending(null);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadCount(controller.signal);
    return () => controller.abort();
  }, [loadCount]);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="relative"
      >
        <Inbox className="mr-2 size-4" aria-hidden="true" /> Unmatched WhatsApp
        {pending ? (
          <span
            className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-xs font-semibold text-white"
            aria-label={`${pending} waiting for review`}
          >
            {pending}
          </span>
        ) : null}
      </Button>
      {open ? (
        <UnmatchedWhatsAppModal
          onClose={() => {
            setOpen(false);
            loadCount();
          }}
        />
      ) : null}
    </>
  );
}

function UnmatchedWhatsAppModal({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<WhatsAppUnmatchedListDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<WhatsAppUnmatchedDto | null>(null);

  // After a review: re-read the queue so the handled message drops out.
  const load = useCallback(async () => {
    try {
      const next = await fetchUnmatchedWhatsApp();
      setList(next);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load unmatched WhatsApp messages.",
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchUnmatchedWhatsApp(controller.signal)
      .then((next) => {
        setList(next);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load unmatched WhatsApp messages.",
        );
      });
    return () => controller.abort();
  }, []);

  async function review(
    item: WhatsAppUnmatchedDto,
    body: { action: "attach"; leadId: number } | { action: "dismiss" },
    label: string,
  ) {
    setBusyId(item.id);
    try {
      await reviewUnmatchedWhatsApp(item.id, body);
      toast.success(label);
      setAttaching(null);
      await load();
    } catch (reviewError) {
      toast.error(
        reviewError instanceof Error
          ? reviewError.message
          : "Could not update the message.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Unmatched WhatsApp messages"
      subtitle="Messages from numbers that match no lead, or more than one. Attach each to the right lead, or dismiss it."
      maxWidthClass="max-w-[760px]"
    >
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-md bg-destructive-light px-3 py-2 text-sm text-destructive-ink"
        >
          {error}
        </p>
      ) : null}
      {!list && !error ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />{" "}
          Loading…
        </div>
      ) : null}
      {list && list.items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing waiting for review.
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {list?.items.map((item) => (
          <li
            key={item.id}
            className="rounded-lg border border-border p-3.5 text-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                <span className="font-mono tabular-nums">
                  {formatE164ForDisplay(item.fromPhoneE164)}
                </span>
                {item.profileName ? (
                  <span className="ml-2 font-normal text-muted-foreground">
                    ({item.profileName})
                  </span>
                ) : null}
              </p>
              <time
                className="text-xs text-muted-foreground"
                dateTime={item.receivedAt}
              >
                {formatSydneyStamp(item.receivedAt)}
              </time>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {REASON_LABELS[item.reason]} · to{" "}
              {item.businessLabel ?? item.businessPhoneNumberId}
            </p>
            {/* Typed by a member of the public: plain text only. */}
            <p
              className={cn(
                "mt-2 whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2",
                item.kind === "UNSUPPORTED" && "italic text-muted-foreground",
              )}
            >
              {item.body}
            </p>

            {item.candidates.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">
                  Leads with this number:
                </span>
                {item.candidates.map((candidate) => (
                  <Button
                    key={candidate.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyId === item.id}
                    onClick={() =>
                      void review(
                        item,
                        { action: "attach", leadId: candidate.id },
                        `Filed on ${candidate.name}.`,
                      )
                    }
                  >
                    Attach to {candidate.name}
                  </Button>
                ))}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap justify-end gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busyId === item.id}
                onClick={() =>
                  void review(item, { action: "dismiss" }, "Dismissed.")
                }
              >
                Dismiss
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyId === item.id}
                onClick={() =>
                  setAttaching(attaching?.id === item.id ? null : item)
                }
              >
                Attach to a lead…
              </Button>
            </div>

            {attaching?.id === item.id ? (
              <LeadChooser
                busy={busyId === item.id}
                onChoose={(lead) =>
                  void review(
                    item,
                    { action: "attach", leadId: lead.id },
                    `Filed on ${lead.name}.`,
                  )
                }
              />
            ) : null}
          </li>
        ))}
      </ul>
    </ModalShell>
  );
}

/** Search every lead and pick one. A person decides; nothing is guessed. */
function LeadChooser({
  busy,
  onChoose,
}: {
  busy: boolean;
  onChoose: (lead: { id: number; name: string }) => void;
}) {
  const leadSearch = useLeadSearch("");
  const [search, setSearch] = useState("");
  const { setQuery } = leadSearch;

  useEffect(() => {
    setQuery(search);
  }, [search, setQuery]);

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search leads by name, email or phone"
          placeholder="Search leads by name, email or phone"
          className="pl-8"
        />
      </div>
      {leadSearch.error ? (
        <p className="text-xs text-destructive-ink">{leadSearch.error}</p>
      ) : null}
      {leadSearch.loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />{" "}
          Searching…
        </p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {leadSearch.items.map((lead) => (
            <li key={lead.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose({ id: lead.id, name: lead.name })}
                className="flex w-full flex-wrap items-baseline justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-background disabled:opacity-50"
              >
                <span className="font-medium">{lead.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[lead.phone, lead.email].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
          {leadSearch.items.length === 0 ? (
            <li className="px-2.5 py-1.5 text-xs text-muted-foreground">
              No leads match.
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
