"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import {
  addTeamPhone,
  fetchTeamPhones,
  removeTeamPhone,
  updateTeamPhone,
} from "@/lib/leads/comms-service";
import type { TeamPhoneDto } from "@/lib/leads/comms-types";

// The team's own phones. "Call via …" on a lead lists every one of them, so
// whoever is taking the call can have it put through to the phone in their
// pocket. The customer always sees the business number.

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function TeamPhoneRow({
  phone,
  onChanged,
}: {
  phone: TeamPhoneDto;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(phone.nickname);
  const [number, setNumber] = useState(formatE164ForDisplay(phone.e164));
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await updateTeamPhone(phone.id, { nickname, number });
      toast.success("Phone updated.");
      setEditing(false);
      onChanged();
    } catch (error) {
      toast.error(message(error, "Could not update the phone."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removeTeamPhone(phone.id);
      toast.success(`${phone.nickname} removed.`);
      onChanged();
    } catch (error) {
      toast.error(message(error, "Could not remove the phone."));
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="border-b border-border/60 py-2.5 last:border-0">
        <form
          onSubmit={(event) => void save(event)}
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <Input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            aria-label="Nickname"
            className="h-9 sm:w-48"
            maxLength={40}
            autoFocus
          />
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            aria-label="Phone number"
            inputMode="tel"
            className="h-9 font-mono tabular-nums sm:w-48"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-3.5" aria-hidden="true" />
              )}
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setNickname(phone.nickname);
                setNumber(formatE164ForDisplay(phone.e164));
                setEditing(false);
              }}
            >
              <X className="size-3.5" aria-hidden="true" />
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-royal-gold-light text-royal-gold-ink">
        <Smartphone className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{phone.nickname}</p>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatE164ForDisplay(phone.e164)}
        </p>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Edit ${phone.nickname}`}
        disabled={busy}
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        aria-label={`Remove ${phone.nickname}`}
        disabled={busy}
        onClick={() => void remove()}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-3.5" aria-hidden="true" />
        )}
      </Button>
    </li>
  );
}

export function TeamPhonesCard({
  officeMobile,
}: {
  /** COMMS_STAFF_FORWARD_NUMBER, offered beside these as "Office mobile". */
  officeMobile: string | null;
}) {
  const [phones, setPhones] = useState<TeamPhoneDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [number, setNumber] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setPhones((await fetchTeamPhones()).phones);
      setError(null);
    } catch (loadError) {
      setError(message(loadError, "Could not load the team phones."));
    }
  }, []);

  useEffect(() => {
    // Deferred a tick: never setState in the effect body.
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (adding) return;
    setAdding(true);
    try {
      const { phone } = await addTeamPhone({ nickname, number });
      toast.success(`${phone.nickname} added.`);
      setNickname("");
      setNumber("");
      void load();
    } catch (addError) {
      toast.error(message(addError, "Could not add the phone."));
    } finally {
      setAdding(false);
    }
  }

  const officeListed =
    officeMobile !== null
    && (phones ?? []).some((phone) => phone.e164 === officeMobile);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold">Team phones</h2>
          <p className="text-sm text-muted-foreground">
            Anyone on the team can take a lead call on their own phone. Press{" "}
            <span className="font-medium text-foreground">Call via …</span> on a
            lead and pick a phone: the lead is rung first, then put through to
            it. The lead sees the business number, never these.
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!phones && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading…
          </p>
        ) : null}
        {phones ? (
          phones.length > 0 || (officeMobile && !officeListed) ? (
            <ul>
              {phones.map((phone) => (
                <TeamPhoneRow
                  key={`${phone.id}:${phone.nickname}:${phone.e164}`}
                  phone={phone}
                  onChanged={() => void load()}
                />
              ))}
              {officeMobile && !officeListed ? (
                <li className="flex items-center gap-3 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Smartphone className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      Office mobile
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums">
                        {formatE164ForDisplay(officeMobile)}
                      </span>{" "}
                      · set by <code>COMMS_STAFF_FORWARD_NUMBER</code>; also
                      takes the inbound calls Mili hands over
                    </p>
                  </div>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
              No phones yet. Add one below and it shows in every lead&apos;s
              Call menu.
            </p>
          )
        ) : null}

        <form
          onSubmit={(event) => void add(event)}
          className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-end"
        >
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            Nickname
            <Input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="e.g. Raj, Site mobile"
              maxLength={40}
              className="h-9 bg-background"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            Phone number
            <Input
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              placeholder="0412 345 678"
              inputMode="tel"
              className="h-9 bg-background font-mono tabular-nums"
            />
          </label>
          <Button
            type="submit"
            disabled={adding || !nickname.trim() || !number.trim()}
          >
            {adding ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            Add phone
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
