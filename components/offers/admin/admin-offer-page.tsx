"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { OfferContentHeader } from "./offer-content-header";
import {
  ADMIN_OFFER_TABS,
  type AdminOfferTabs,
  adminPanelId,
  adminTabId,
  dirtyByTab,
} from "./offer-content-tabs";
import { JobSetupScreen } from "./job-setup-screen";
import { OfferCostScheduleScreen } from "./cost-schedule-screen";
import { OfferScopePage } from "./offer-scope-page";
import { OfferContentPage } from "./offer-content-page";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { hydrated } from "@/lib/store/slices/adminOfferContentSlice";
import type { AdminOfferContent } from "@/types/admin-offer-content";
import { HBCFClaimPage } from "./hbcf-claim-page";
import { OfferInclusionsPage } from "./offer-inclusion-page";

interface AdminOfferPageProps {
  initialContent: AdminOfferContent;
}

export function AdminOfferPage({ initialContent }: AdminOfferPageProps) {
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<AdminOfferTabs>("job-setup");
  const dirty = useAppSelector((s) => s.adminOfferContent.dirty);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    dispatch(hydrated(initialContent));
  }, [dispatch, initialContent]);

  return (
    <div className="space-y-6">
      <PageHeader
        headingLevel="h1"
        title="Offer Pre-Fill Content"
        description="Define the reusable boilerplate content pre-filled onto every new construction offer — build scope, cost schedule, allowances, exclusions, and document copy."
        badge={
          <Badge className="bg-royal-gold-light text-royal-gold-ink-text">
            Admin
          </Badge>
        }
      />

      <OfferContentHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        dirtyTabs={dirtyByTab(dirty)}
      />

      {/* The panel the open tab controls, labelled by that tab. The screens
          title their cards h3, so the sr-only h2 keeps the outline from
          skipping a level under the hero's h1. */}
      <section
        role="tabpanel"
        id={adminPanelId(activeTab)}
        aria-labelledby={adminTabId(activeTab)}
        tabIndex={0}
      >
        <h2 className="sr-only">
          {ADMIN_OFFER_TABS.find((tab) => tab.id === activeTab)?.label}
        </h2>
        {activeTab === "job-setup" && <JobSetupScreen />}
        {activeTab === "cost-schedule" && <OfferCostScheduleScreen />}
        {activeTab === "offer-scope" && <OfferScopePage />}
        {activeTab === "offer-inclusions" && <OfferInclusionsPage />}
        {activeTab === "offer-content" && <OfferContentPage />}
        {activeTab === "HBCF-claim" && <HBCFClaimPage />}
      </section>
    </div>
  );
}
