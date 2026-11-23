"use client";

import { useEffect } from "react";

// The Calls log's "Open dialer" asks the header's dialer to open. A window
// event rather than shared state, so each can mount on its own. Server state
// (the calls, the badge) is not passed this way: it is React Query's
// (./project-calls-queries.ts).

const OPEN_DIALER = "project-calls:open-dialer";

type Detail = { projectId: string };

export function requestProjectDialer(projectId: string): void {
  window.dispatchEvent(
    new CustomEvent<Detail>(OPEN_DIALER, { detail: { projectId } }),
  );
}

export function useProjectDialerRequest(
  projectId: string,
  handler: () => void,
): void {
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<Detail>).detail?.projectId === projectId)
        handler();
    };
    window.addEventListener(OPEN_DIALER, listener);
    return () => window.removeEventListener(OPEN_DIALER, listener);
  }, [projectId, handler]);
}
