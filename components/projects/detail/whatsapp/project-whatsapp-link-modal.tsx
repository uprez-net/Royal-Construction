"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Info, Loader2, RefreshCw, Users } from "lucide-react";

import { ModalShell } from "@/components/common/modal-shell";
import { Button } from "@/components/ui/button";
import {
  announceProjectWhatsAppChange,
  fetchLinkableWhatsAppGroups,
  linkProjectWhatsAppGroup,
} from "@/lib/projects/whatsapp-service";
import type { LinkableWhatsAppGroupDto } from "@/lib/projects/whatsapp-types";
import { cn } from "@/lib/utils";

const CREATED = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  timeZone: "Australia/Sydney",
  year: "numeric",
});

/**
 * Link one of the business's existing WhatsApp groups to a project already
 * underway. Only groups made through WhatsApp's API are listed — that is all
 * WhatsApp lets an app see — and the modal says so, so nobody hunts for a
 * group they made on their phone.
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
  const [groups, setGroups] = useState<LinkableWhatsAppGroupDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
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
            : "Could not list the business's WhatsApp groups.",
        );
      });
    return () => controller.abort();
  }, [projectId, version]);

  async function link() {
    if (!chosen || linking) return;
    setLinking(true);
    try {
      const result = await linkProjectWhatsAppGroup(projectId, chosen);
      toast.success(
        result.filedMessages > 0
          ? `Group linked. ${result.filedMessages} earlier message${result.filedMessages === 1 ? " was" : "s were"} filed onto this project.`
          : "Group linked to this project.",
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
      subtitle="Groups created through the app or WhatsApp's API that aren't on a project yet."
      maxWidthClass="max-w-[560px]"
    >
      <div className="space-y-4">
        <p className="flex gap-2 rounded-xl bg-[#fff5c4]/70 px-3 py-2.5 text-[13px] text-[#54656f]">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />A group
          someone made on their phone can&apos;t be linked — WhatsApp
          doesn&apos;t let apps read those. Create a new group for the project
          instead and invite the owners.
        </p>

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
            Asking WhatsApp for the business&apos;s groups…
          </p>
        ) : groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Every group this business has is already on a project.
          </p>
        ) : (
          <ul
            className="max-h-[45vh] space-y-1.5 overflow-y-auto"
            role="radiogroup"
            aria-label="Groups"
          >
            {groups.map((group) => {
              const selected = chosen === group.providerGroupId;
              return (
                <li key={group.providerGroupId}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setChosen(group.providerGroupId)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                      selected
                        ? "border-[#00a884] bg-[#e7fce3]"
                        : "border-border/70 hover:bg-muted/50",
                    )}
                  >
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-[#54656f]">
                      <Users className="size-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {group.subject || "Untitled group"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {group.businessLabel}
                        {group.createdAt
                          ? ` · created ${CREATED.format(new Date(group.createdAt))}`
                          : ""}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-4.5 shrink-0 rounded-full border-2",
                        selected
                          ? "border-[#00a884] bg-[#00a884] shadow-[inset_0_0_0_3px_white]"
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
            className="bg-[#00a884] text-white hover:bg-[#008f72]"
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
