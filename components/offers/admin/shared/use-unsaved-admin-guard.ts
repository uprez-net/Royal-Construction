"use client";

import { useEffect } from "react";
import { useAppSelector } from "@/lib/store/hooks";

// Admin edits live only in the Redux store until saved. The store survives
// in-app navigation, but a reload or a closed tab loses it, so the browser is
// asked to confirm while any section still has unsaved edits. Every admin tab
// renders a SaveChangesButton, which is where this is mounted.
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
