"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Info, Loader2, RefreshCw, Search, Users } from "lucide-react";

import { ModalShell } from "@/components/common/modal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  announceProjectWhatsAppChange,
  fetchLinkableWhatsAppGroups,
  linkProjectWhatsAppGroup,
} from "@/lib/projects/whatsapp-service";
import type { WhatsAppBridgeGroupDto } from "@/lib/projects/whatsapp-types";
import { cn } from "@/lib/utils";

const CREATED = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  timeZone: "Australia/Sydney",
  year: "numeric",
});

/**
 * Link one of the groups Royal's WhatsApp number is in to this project — one
 * made on the phone included. Groups already on a project are not offered;
 * Admin › WhatsApp bridge shows those and can move them.
 */
export function ProjectWhatsAppLinkModal({
  projectId,
  onClose,
  onLinked,
}: {
  projectId: string;
  onClose: () => void;
  onLinked?: () => void;
}) {
  const [groups, setGroups] = useState<WhatsAppBridgeGroupDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchLinkableWhatsAppGroups(projectId, controller.signal)
      .then((result) => {
        setGroups(result.groups);
        setError(null);
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not list the WhatsApp groups.",
        );
      });
    return () => controller.abort();
  }, [projectId, version]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (groups ?? []).filter(
      (group) => !needle || group.subject.toLowerCase().includes(needle),
    );
  }, [groups, query]);

  async function link() {
    if (!chosen || linking) return;
    setLinking(true);
    try {
      const result = await linkProjectWhatsAppGroup(projectId, chosen);
      toast.success(
        result.alreadyLinked
          ? "That group was already linked to this project."
          : "Group linked. New messages in it now come into this project.",
      );
      announceProjectWhatsAppChange(projectId);
      onLinked?.();
      onClose();
    } catch (linkError) {
      toast.error(
        linkError instanceof Error
          ? linkError.message
          : "The group could not be linked.",
      );
    } finally {
      setLinking(false);
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Link an existing WhatsApp group"
      subtitle="Groups Royal's WhatsApp number is in that aren't on a project yet."
      maxWidthClass="max-w-[560px]"
    >
      <div className="space-y-4">
        <p className="flex gap-2 rounded-xl bg-info-light px-3 py-2.5 text-[13px] text-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Not listed? Add Royal&apos;s number to the group on the phone first.
          Messages from before it was linked aren&apos;t brought across.
        </p>

        {groups && groups.length > 6 ? (
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search groups"
              aria-label="Search groups"
              className="pl-9"
            />
          </div>
        ) : null}

        {error ? (
          <div className="space-y-2 text-center">
            <p role="alert" className="text-sm text-destructive-ink">
              {error}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVersion((value) => value + 1)}
            >
              <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : !groups ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Asking WhatsApp for Royal&apos;s groups…
          </p>
        ) : groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Every group Royal&apos;s number is in is already on a project.
          </p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No group matches “{query}”.
          </p>
        ) : (
          <ul
            className="max-h-[45vh] space-y-1.5 overflow-y-auto"
            role="radiogroup"
            aria-label="Groups"
          >
            {shown.map((group) => {
              const selected = chosen === group.groupJid;
              return (
                <li key={group.groupJid}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setChosen(group.groupJid)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                      selected
                        ? "border-primary bg-royal-gold-light"
                        : "border-border/70 hover:bg-muted/50",
                    )}
                  >
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Users className="size-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {group.subject || "Untitled group"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {group.memberCount} member
                        {group.memberCount === 1 ? "" : "s"}
                        {group.createdAt
                          ? ` · created ${CREATED.format(new Date(group.createdAt))}`
                          : ""}
                        {group.isAdmin ? "" : " · Royal isn't an admin"}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-4.5 shrink-0 rounded-full border-2",
                        selected
                          ? "border-primary bg-primary shadow-[inset_0_0_0_3px_white]"
                          : "border-muted-foreground/40",
                      )}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!chosen || linking}
            onClick={() => void link()}
            className="bg-primary text-primary-foreground"
          >
            {linking ? (
              <Loader2
                className="mr-1.5 size-4 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            Link group
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
