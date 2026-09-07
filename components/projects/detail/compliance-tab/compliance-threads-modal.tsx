"use client";

import { ComplianceOutreachMode, CompliancePartyType } from "@prisma/client";
import { useMemo, useState } from "react";

import { ModalShell } from "@/components/common/modal-shell";
import { Badge } from "@/components/ui/badge";
import { PARTY_LABEL } from "@/constants/complianceDocuments";
import { cn } from "@/lib/utils";
import type {
  CertifierEmailRecord,
  ComplianceOutreachDetail,
} from "@/types/compliance";
import type { CertifierReplyAttachment } from "@/utils/validators/compliance";

import { CertifierThread } from "./certifier-thread";

type SendInput = { body: string; attachments: CertifierReplyAttachment[] };

/**
 * One tab: a correspondent, their transcript, and how to answer them.
 *
 * `onSend` being null is what makes a tab read-only, and it is derived rather
 * than passed as a flag: a thread with nobody to send to is exactly a thread
 * with no send handler.
 */
type ThreadTab = {
  key: string;
  label: string;
  emails: CertifierEmailRecord[];
  onSend: ((input: SendInput) => Promise<void>) | null;
  isSending: boolean;
};

type ComplianceThreadsModalProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** The certifier's own thread — the engagement's, not an outreach's. */
  certifierEmails: CertifierEmailRecord[];
  isSendingToCertifier: boolean;
  onSendToCertifier: (input: SendInput) => Promise<void>;
  outreaches: ComplianceOutreachDetail[];
  isSendingToParty: (outreachId: string) => boolean;
  onSendToParty: (outreachId: string, input: SendInput) => Promise<void>;
};

/**
 * Every conversation on the compliance file, one tab per correspondent.
 *
 * It was "Show certifier thread" when there was one thread. There are now up to
 * four running at once and they are not interchangeable — the surveyor is being
 * chased for a title search while the architect is answering a question about
 * setbacks — so a single merged transcript would be unreadable and a single
 * composer would be dangerous.
 *
 * Tabs rather than four buttons on the tab header: they are the same kind of
 * thing viewed one at a time, and the reader is usually here to check one and
 * then glance at another.
 *
 * A party with no thread still gets a tab. An empty transcript that says so is
 * the answer to "did we ever hear back from the surveyor"; a missing tab looks
 * like the feature is not there.
 */
export function ComplianceThreadsModal({
  open,
  onClose,
  projectId,
  certifierEmails,
  isSendingToCertifier,
  onSendToCertifier,
  outreaches,
  isSendingToParty,
  onSendToParty,
}: ComplianceThreadsModalProps) {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [activeKey, setActiveKey] = useState("certifier");

  const tabs = useMemo<ThreadTab[]>(() => {
    const partyTabs = outreaches
      // Stable, and in flow order rather than in creation order: the surveyor
      // comes before the architect on the page, and the tabs re-ordering
      // themselves because somebody was engaged out of sequence is a set of
      // tabs that moves under the reader.
      .slice()
      .sort(
        (a, b) =>
          PARTY_ORDER.indexOf(a.party) - PARTY_ORDER.indexOf(b.party),
      )
      .map((outreach) => ({
        key: outreach.id,
        label: PARTY_LABEL[outreach.party],
        emails: outreach.emails,
        // Nothing to reply to on a self-supplied row — there is no address —
        // and the planning portal is not a correspondent.
        onSend:
          outreach.mode === ComplianceOutreachMode.SELF_SUPPLIED ||
          outreach.party === CompliancePartyType.COUNCIL ||
          !outreach.contactEmail
            ? null
            : (input: SendInput) => onSendToParty(outreach.id, input),
        isSending: isSendingToParty(outreach.id),
      }));

    return [
      {
        key: "certifier",
        label: "Certifier",
        emails: certifierEmails,
        onSend: onSendToCertifier,
        isSending: isSendingToCertifier,
      },
      ...partyTabs,
    ];
  }, [
    certifierEmails,
    isSendingToCertifier,
    onSendToCertifier,
    outreaches,
    isSendingToParty,
    onSendToParty,
  ]);

  // A tab can disappear between renders — an outreach is never deleted today,
  // but the store replaces the engagement wholesale on every write, and falling
  // back to the first tab is cheaper than reasoning about when it cannot.
  const active = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];
  const total = tabs.reduce((sum, tab) => sum + tab.emails.length, 0);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Compliance threads"
      subtitle={`${total} message${total === 1 ? "" : "s"} across ${tabs.length} conversation${tabs.length === 1 ? "" : "s"}`}
      maxWidthClass="max-w-[820px]"
      isFullScreenable
      isFullScreen={isFullScreen}
      onToggleFullScreen={(minimize) => setIsFullScreen(minimize ? false : true)}
    >
      <div
        role="tablist"
        aria-label="Compliance conversations"
        className="mb-3 flex flex-wrap gap-1 border-b border-border/70"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active?.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveKey(tab.key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                isActive
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.emails.length > 0 ? (
                <Badge variant="secondary">{tab.emails.length}</Badge>
              ) : null}
            </button>
          );
        })}
      </div>

      {active ? (
        <CertifierThread
          // Remounted per tab on purpose. The composer holds an unsent draft
          // and a list of uploaded attachments, and carrying either across a
          // tab switch is how a message meant for the surveyor goes to the
          // architect.
          key={active.key}
          projectId={projectId}
          emails={active.emails}
          isSending={active.isSending}
          onSend={active.onSend ?? (async () => {})}
          readOnly={active.onSend === null}
          counterpartyLabel={active.label.toLowerCase()}
          isFullScreen={isFullScreen}
        />
      ) : null}
    </ModalShell>
  );
}

/** Flow order, which is also the order the sections appear in on the tab. */
const PARTY_ORDER: readonly CompliancePartyType[] = [
  CompliancePartyType.SURVEYOR,
  CompliancePartyType.ARCHITECT,
  CompliancePartyType.COUNCIL,
];
