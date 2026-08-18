"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  type AdminOfferTabs,
  OfferContentHeader,
} from "./offer-content-header";
import { JobSetupScreen } from "./job-setup-screen";
import { OfferCostScheduleScreen } from "./cost-schedule-screen";
import { OfferScopePage } from "./offer-scope-page";
import { OfferContentPage } from "./offer-content-page";
import { useAppDispatch } from "@/lib/store/hooks";
import { hydrated } from "@/lib/store/slices/adminOfferContentSlice";
import type { AdminOfferContent } from "@/types/admin-offer-content";
import { Settings2 } from "lucide-react";
import { HBFCClaimPage } from "./hbfc-claim-page";

interface AdminOfferPageProps {
  initialContent: AdminOfferContent;
}

export function AdminOfferPage({ initialContent }: AdminOfferPageProps) {
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<AdminOfferTabs>("job-setup");
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    dispatch(hydrated(initialContent));
  }, [dispatch, initialContent]);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-royal-gold/20 bg-linear-to-br from-royal-gold-light via-amber-50 to-yellow-50 shadow-sm">
        <CardContent className="relative p-6">
          <div className="absolute -right-12 -top-10 size-40 rounded-full bg-royal-gold/10" />
          <div className="absolute -bottom-14 right-20 size-32 rounded-full bg-royal-gold-dark/10" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-royal-gold/15 text-royal-gold-dark">
                <Settings2 className="size-5" aria-hidden="true" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-extrabold text-slate-900">
                    Offer Pre-Fill Content
                  </h2>
                  <Badge className="bg-royal-gold text-white">Admin</Badge>
                </div>
                <p className="text-sm text-slate-600">
                  Define the reusable boilerplate content pre-filled onto every
                  new construction offer — build scope, cost schedule, allowances,
                  exclusions, and document copy.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <OfferContentHeader activeTab={activeTab} onTabChange={setActiveTab} />

      <div>
        {activeTab === "job-setup" && <JobSetupScreen />}
        {activeTab === "cost-schedule" && <OfferCostScheduleScreen />}
        {activeTab === "offer-scope" && <OfferScopePage />}
        {activeTab === "offer-content" && <OfferContentPage />}
        {activeTab === "HBFC-claim" && <HBFCClaimPage />}
      </div>
    </div>
  );
}
