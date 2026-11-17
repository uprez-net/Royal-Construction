"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Link2, Loader2, Send } from "lucide-react";

import { CopyButton } from "@/components/common/copy-button";
import { ModalShell } from "@/components/common/modal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import {
  announceProjectWhatsAppChange,
  fetchProjectWhatsAppInviteDraft,
  sendProjectWhatsAppInvite,
} from "@/lib/projects/whatsapp-service";
import type { ProjectWhatsAppInviteDraftDto } from "@/lib/projects/whatsapp-types";
import { cn } from "@/lib/utils";

/**
 * Email the owners an invite into the project's WhatsApp group.
 *
 * Starts from a draft the server writes (the owners, the link, a friendly
 * message), which the office edits before it goes — it reaches a client. The
 * server refuses an address that isn't an owner's and a body without the
 * group's link, so this screen can't send an invite that invites nobody.
 */
export function ProjectWhatsAppInviteModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ProjectWhatsAppInviteDraftDto | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  // One key per invite, rotated only after it went out.
  const sendKey = useIdempotencyKey();

  useEffect(() => {
    const controller = new AbortController();
    fetchProjectWhatsAppInviteDraft(projectId, controller.signal)
      .then((loaded) => {
        setDraft(loaded);
        setRecipients(loaded.recipients.map((recipient) => recipient.email));
        setSubject(loaded.subject);
        setBody(loaded.body);
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not prepare the invite.",
        );
      });
    return () => controller.abort();
  }, [projectId]);

  const linkMissing = Boolean(draft && !body.includes(draft.inviteLink));
  const canSend =
    !sending
    && Boolean(draft)
    && recipients.length > 0
    && subject.trim().length > 0
    && body.trim().length > 0
    && !linkMissing;

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      const result = await sendProjectWhatsAppInvite(
        projectId,
        { body, recipients, subject },
        sendKey.current(),
      );
      sendKey.rotate();
      toast.success(
        result.alreadySent
          ? "This invite had already been sent — it was not sent again."
          : `Invite emailed to ${result.recipients.join(", ")}.`,
      );
      announceProjectWhatsAppChange(projectId);
      onClose();
    } catch (sendError) {
      toast.error(
        sendError instanceof Error
          ? sendError.message
          : "The invite could not be sent.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Invite the owners to the WhatsApp group"
      subtitle="Check the wording — this email goes to the client."
      maxWidthClass="max-w-[620px]"
    >
      {error ? (
        <p
          role="alert"
          className="py-6 text-center text-sm text-destructive-ink"
        >
          {error}
        </p>
      ) : !draft ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Preparing the invite…
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              To
            </legend>
            {draft.recipients.length === 0 ? (
              <p className="rounded-lg bg-warning-light px-3 py-2 text-sm text-warning-ink">
                No owner on this contract has an email address. Add one on the
                Overview tab, or copy the link and send it another way.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {draft.recipients.map((recipient) => {
                  const on = recipients.includes(recipient.email);
                  return (
                    <button
                      key={recipient.email}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setRecipients((current) =>
                          on
                            ? current.filter(
                                (email) => email !== recipient.email,
                              )
                            : [...current, recipient.email],
                        )
                      }
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition",
                        on
                          ? "border-primary bg-royal-gold-light text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      {on ? (
                        <Check className="size-3.5" aria-hidden="true" />
                      ) : null}
                      <span className="font-medium">{recipient.name}</span>
                      <span className="text-xs opacity-80">
                        {recipient.email}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="invite-subject">Subject</Label>
            <Input
              id="invite-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-body">Message</Label>
            <Textarea
              id="invite-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={9}
              className="leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">
              Your name and &ldquo;Royal Constructions&rdquo; are added as the
              signature, with a green &ldquo;Join the WhatsApp group&rdquo;
              button under the message.
            </p>
            {linkMissing ? (
              <p role="alert" className="text-xs text-destructive-ink">
                Keep the group link in the message — without it the owners
                can&apos;t join.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate font-mono">{draft.inviteLink}</span>
            </span>
            <CopyButton
              value={draft.inviteLink}
              label="Copy link"
              successToast="Invite link copied."
              variant="ghost"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSend}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {sending ? (
                <Loader2
                  className="mr-1.5 size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Send className="mr-1.5 size-4" aria-hidden="true" />
              )}
              Send invite
            </Button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}
