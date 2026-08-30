"use client";

import { useState } from "react";

import { ModalShell } from "@/components/common/modal-shell";
import type { CertifierEmailRecord } from "@/types/compliance";
import type { CertifierReplyAttachment } from "@/utils/validators/compliance";
import { CertifierThread } from "./certifier-thread";

type CertifierThreadModalProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  emails: CertifierEmailRecord[];
  isSending: boolean;
  onSend: (input: {
    body: string;
    attachments: CertifierReplyAttachment[];
  }) => Promise<void>;
};

/**
 * The certifier conversation, in the same shell the lead messages use.
 *
 * It sat at the bottom of the tab before, which meant the thread — the one part
 * of this screen someone reads rather than scans — was only reachable after
 * scrolling past every document block. On demand and full-screenable is a
 * better fit for how it is actually used.
 */
export function CertifierThreadModal({
  open,
  onClose,
  projectId,
  emails,
  isSending,
  onSend,
}: CertifierThreadModalProps) {
  const [isFullScreen, setIsFullScreen] = useState(false);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Certifier thread"
      subtitle={`${emails.length} message${emails.length === 1 ? "" : "s"} with the principal certifier`}
      maxWidthClass="max-w-[820px]"
      isFullScreenable
      isFullScreen={isFullScreen}
      onToggleFullScreen={(minimize) => setIsFullScreen(minimize ? false : true)}
    >
      <CertifierThread
        projectId={projectId}
        emails={emails}
        isSending={isSending}
        onSend={onSend}
        isFullScreen={isFullScreen}
      />
    </ModalShell>
  );
}
