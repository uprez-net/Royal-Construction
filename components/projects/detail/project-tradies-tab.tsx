import type { TradieRequestKind } from "@prisma/client";
import type { ProjectDetail } from "@/types/project";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { toast } from "sonner";
import { useAppDispatch } from "@/lib/store/hooks";
import { dismissTradieAlerts } from "@/lib/store/slices/projectsSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import { TradieAttentionCard } from "./tradie-attention-card";
import { useTradieAttention } from "./tradie-attention";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { sameTrade } from "@/lib/domain/tradies/request-rules";
import { projectTrades, tradeOverview } from "./tradie-requests";
import { TradeList, TradeWorkbench } from "./tradie-trade-overview";
import { TradeSelector } from "./trade-selector";

export function ProjectTradiesTab({ project }: { project: ProjectDetail }) {
  const attentionItems = useTradieAttention(project.tradieSchedules);
  const dispatch = useAppDispatch();

  // The trade being looked at lives in the URL, beside `activeTab`, so it
  // survives a reload and the back button, and a fresh visit starts on "All".
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const trades = useMemo(() => projectTrades(project), [project]);
  const tradeParam = searchParams.get("trade");
  const trade = tradeParam
    ? (trades.find((option) => sameTrade(option, tradeParam)) ?? null)
    : null;

  const selectTrade = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(searchParamsString);
      if (next) params.set("trade", next);
      else params.delete("trade");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParamsString],
  );

  const overviews = useMemo(
    () => trades.map((option) => tradeOverview(project, option)),
    [project, trades],
  );
  const overview = trade
    ? overviews.find((item) => item.trade === trade)
    : undefined;

  const openRequestWizard = (kind?: TradieRequestKind) =>
    dispatch(
      openModal({
        type: "scheduleTradie",
        payload: {
          project,
          ...(trade ? { trade } : {}),
          ...(kind ? { kind } : {}),
        },
      }),
    );

  return (
    <div className="space-y-4">
      <TradieAttentionCard
        items={attentionItems}
        project={project}
        onDismiss={async (scheduleIds) => {
          try {
            await dispatch(
              dismissTradieAlerts({ projectId: project.id, scheduleIds }),
            ).unwrap();
          } catch (error) {
            toast.error(
              typeof error === "string"
                ? error
                : "Unable to dismiss the alerts",
            );
          }
        }}
      />

      <SectionCard
        title="Trade requests"
        description="Ask tradies to quote for a trade's activities and compare what comes back, or book one directly and record their price later."
        action={
          <Button
            size="sm"
            className="h-8 rounded-md px-3 text-xs font-medium"
            onClick={() => openRequestWizard()}
          >
            <Plus className="mr-1 size-3.5" aria-hidden="true" />
            Schedule tradies
          </Button>
        }
      >
        <div className="space-y-4">
          {trades.length > 0 ? (
            <TradeSelector
              trades={trades}
              value={trade}
              onChange={selectTrade}
            />
          ) : null}

          {overview ? (
            <TradeWorkbench
              project={project}
              overview={overview}
              onRequest={openRequestWizard}
            />
          ) : trades.length > 0 ? (
            <TradeList overviews={overviews} onSelect={selectTrade} />
          ) : (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No activities on this project name a trade yet, and nobody has
              been booked. Use Schedule tradies to send a first request.
            </p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
