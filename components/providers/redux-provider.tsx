"use client";

import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { UnsavedAdminGuard } from "@/components/offers/admin/shared/use-unsaved-admin-guard";

import { store } from "@/lib/store";

export function ReduxProvider({ children }: { children: ReactNode }) {
  return (
    <Provider store={store}>
      {/* Above every route: admin edits live in this store, so the unsaved-edits
          warning must outlive the editor that made them. */}
      <UnsavedAdminGuard />
      {children}
    </Provider>
  );
}