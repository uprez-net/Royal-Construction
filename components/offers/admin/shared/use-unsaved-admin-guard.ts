"use client";

import { useEffect } from "react";
import { useAppSelector } from "@/lib/store/hooks";

// Admin edits live only in the Redux store until saved. The store survives
// in-app navigation, but a reload or a closed tab loses it, so the browser is
// asked to confirm while any section still has unsaved edits. It is mounted
// once by ReduxProvider, above every route: mounted by the editor instead, it
// stopped warning the moment an admin navigated away with edits still unsaved,
// and the reload that lost them was silent.
export function useUnsavedAdminGuard(): void {
  const anyDirty = useAppSelector((s) =>
    Object.values(s.adminOfferContent.dirty).some(Boolean),
  );

  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty]);
}

/** Mounts the guard for the whole app. Renders nothing. */
export function UnsavedAdminGuard(): null {
  useUnsavedAdminGuard();
  return null;
}
