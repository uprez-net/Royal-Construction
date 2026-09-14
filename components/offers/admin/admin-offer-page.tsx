"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeroCard } from "@/components/common/page-hero-card";
import { Badge } from "@/components/ui/badge";
import { OfferContentHeader } from "./offer-content-header";
import { type AdminOfferTabs, dirtyByTab } from "./offer-content-tabs";
import { JobSetupScreen } from "./job-setup-screen";
import { OfferCostScheduleScreen } from "./cost-schedule-screen";
import { OfferScopePage } from "./offer-scope-page";
import { OfferContentPage } from "./offer-content-page";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { hydrated } from "@/lib/store/slices/adminOfferContentSlice";
import type { AdminOfferContent } from "@/types/admin-offer-content";
import { Settings2 } from "lucide-react";
import { HBFCClaimPage } from "./hbfc-claim-page";
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
      <PageHeroCard
        headingLevel="h1"
        title="Offer Pre-Fill Content"
        description="Define the reusable boilerplate content pre-filled onto every new construction offer — build scope, cost schedule, allowances, exclusions, and document copy."
        icon={<Settings2 />}
        badge={<Badge className="bg-royal-gold-ink text-white">Admin</Badge>}
      />

      <OfferContentHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        dirtyTabs={dirtyByTab(dirty)}
      />

      <div>
        {activeTab === "job-setup" && <JobSetupScreen />}
        {activeTab === "cost-schedule" && <OfferCostScheduleScreen />}
        {activeTab === "offer-scope" && <OfferScopePage />}
        {activeTab === "offer-inclusions" && <OfferInclusionsPage />}
        {activeTab === "offer-content" && <OfferContentPage />}
        {activeTab === "HBFC-claim" && <HBFCClaimPage />}
      </div>
    </div>
  );
}
