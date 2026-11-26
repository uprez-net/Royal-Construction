"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Check, Loader2, Pencil, PhoneIncoming, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import {
  clearOwnerLine,
  fetchOwnerLine,
  saveOwnerLine,
} from "@/lib/leads/comms-service";
import type { OwnerLineDto } from "@/lib/leads/comms-types";

// The owner line: the business owner's own phone, where Mili rings with a
// briefing Hermes (their personal assistant) asks for — a project brief, a
// reminder before a meeting, an alert. Hermes says what to tell them, never
// who to call: this is the only number those calls can ring.

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function OwnerLineCard({
  hermesCalls,
  hermesAssistant,
  hermesEndpoint,
  voiceAgent,
}: {
  /** HERMES_MCP_SECRET is set. */
  hermesCalls: boolean;
  /** HERMES_SERVER_MCP_* is set. */
  hermesAssistant: boolean;
  hermesEndpoint: string | null;
  /** Mili is switched on and reachable. */
  voiceAgent: boolean;
}) {
  const [line, setLine] = useState<OwnerLineDto | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { ownerLine } = await fetchOwnerLine();
      setLine(ownerLine);
      setError(null);
    } catch (loadError) {
      setError(message(loadError, "Could not load the owner line."));
    }
  }, []);

  useEffect(() => {
    // Deferred a tick: never setState in the effect body.
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  function startEditing() {
    setNickname(line?.nickname ?? "");
    setNumber(line ? formatE164ForDisplay(line.e164) : "");
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { ownerLine } = await saveOwnerLine({ nickname, number });
      setLine(ownerLine);
      setEditing(false);
      toast.success("Owner line saved.");
    } catch (saveError) {
      toast.error(message(saveError, "Could not save the owner line."));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    try {
      await clearOwnerLine();
      setLine(null);
      toast.success("Owner line cleared. Mili won't ring anyone for Hermes.");
    } catch (clearError) {
      toast.error(message(clearError, "Could not clear the owner line."));
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(line) && hermesCalls && voiceAgent;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold">Owner line</h2>
          <p className="text-sm text-muted-foreground">
            The owner&apos;s own phone. Hermes, their personal assistant, can
            ask Mili to ring it with a briefing: a project brief, a reminder
            before a meeting, an alert. If the owner asks something the briefing
            doesn&apos;t cover, Mili checks with Hermes on the call. These calls
            only ever ring this number.
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {line === undefined && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading…
          </p>
        ) : null}

        {line !== undefined && !editing ? (
          line ? (
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-royal-gold-light text-royal-gold-ink">
                <PhoneIncoming className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{line.nickname}</p>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatE164ForDisplay(line.e164)}
                </p>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Change the owner line"
                disabled={busy}
                onClick={startEditing}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                aria-label="Clear the owner line"
                disabled={busy}
                onClick={() => void clear()}
              >
                {busy ? (
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Trash2 className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>Not set. Hermes can&apos;t ask Mili to call anyone.</span>
              <Button type="button" size="sm" onClick={startEditing}>
                Set owner line
              </Button>
            </div>
          )
        ) : null}

        {editing ? (
          <form
            onSubmit={(event) => void save(event)}
            className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-end"
          >
            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
              First name (Mili greets them by it)
              <Input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="e.g. Raj"
                maxLength={40}
                className="h-9 bg-background"
                autoFocus
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
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={busy || !nickname.trim() || !number.trim()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="size-4" aria-hidden="true" />
                )}
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                <X className="size-4" aria-hidden="true" />
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>
            Hermes can place calls:{" "}
            <span className="font-medium text-foreground">
              {hermesCalls ? "yes" : "no"}
            </span>
            {hermesCalls ? null : (
              <>
                {" "}
                (set <code>HERMES_MCP_SECRET</code>)
              </>
            )}
          </li>
          <li>
            Mili can check with Hermes on the call:{" "}
            <span className="font-medium text-foreground">
              {hermesAssistant ? "yes" : "no"}
            </span>
            {hermesAssistant ? null : (
              <>
                {" "}
                (set <code>HERMES_SERVER_MCP_URL</code> and{" "}
                <code>HERMES_SERVER_MCP_TOKEN</code>)
              </>
            )}
          </li>
          {hermesCalls && hermesEndpoint ? (
            <li>
              Hermes connects to the operations agent at{" "}
              <code className="break-all">{hermesEndpoint}</code>, sending{" "}
              <code>HERMES_MCP_SECRET</code> in the <code>X-Hermes-Secret</code>{" "}
              header. Its calls are under{" "}
              <Link className="underline" href="/admin/agent-calls">
                Agent calls
              </Link>
              .
            </li>
          ) : null}
          {line && hermesCalls && !voiceAgent ? (
            <li className="text-warning-ink">
              Mili is off, so a call Hermes asks for is refused.
            </li>
          ) : null}
          {ready ? (
            <li className="text-success-ink">
              Ready: Hermes can brief the owner by phone.
            </li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  );
}
