import { ArrowUpRight, PiggyBank, ReceiptText, Users, Wallet2 } from "lucide-react";
import { useAppSelector } from "@/lib/store/hooks";
import { selectActiveProjectBudgetSummary } from "@/lib/store/slices/projectsSlice";
import { projectKpiMock } from "@/lib/mock-data";
import { currency } from "@/utils/formatters";

export function ProjectStatCards() {
  const budgetSummary = useAppSelector(selectActiveProjectBudgetSummary);
  const isNewProject = useAppSelector((state) => state.projects.activeProject?.milestones.length === 0);

  if (!budgetSummary) {
    return null;
  }

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Contract Value */}
      <div className="rounded-xl border border-border/70 bg-white p-5 shadow-sm transition-all hover:shadow-md">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex size-11 items-center justify-center rounded-xl bg-teal-600 text-xl text-white">
            <Wallet2 className="size-5" />
          </div>
          <div className="inline-flex items-center gap-1 rounded-md bg-green-600/10 px-2 py-0.5 text-[10.5px] font-bold text-green-700">
            <ArrowUpRight className="size-3" />
            On Budget
          </div>
        </div>
        <div className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">
          {currency.format(budgetSummary.totalBudget)}
        </div>
        <div className="mt-1 text-[11.5px] text-muted-foreground">Total Contract Value</div>
      </div>

      {/* Spent */}
      <div className="rounded-xl border border-border/70 bg-white p-5 shadow-sm transition-all hover:shadow-md">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex size-11 items-center justify-center rounded-xl bg-[#E8730C] text-xl text-white">
            <ReceiptText className="size-5" />
          </div>
          <div className="text-[11px] font-bold text-muted-foreground">
            {budgetSummary.spentPercent}%
          </div>
        </div>
        <div className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">
          {currency.format(budgetSummary.spent)}
        </div>
        <div className="mt-1 text-[11.5px] text-muted-foreground">Spent to Date</div>
      </div>

      {/* Remaining */}
      <div className="rounded-xl border border-border/70 bg-white p-5 shadow-sm transition-all hover:shadow-md">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex size-11 items-center justify-center rounded-xl bg-green-600 text-xl text-white">
            <PiggyBank className="size-5" />
          </div>
        </div>
        <div className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">
          {currency.format(budgetSummary.remaining)}
        </div>
        <div className="mt-1 text-[11.5px] text-muted-foreground">Remaining Budget</div>
      </div>

      {/* Workers */}
      <div className="rounded-xl border border-border/70 bg-white p-5 shadow-sm transition-all hover:shadow-md">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex size-11 items-center justify-center rounded-xl bg-blue-600 text-xl text-white">
            <Users className="size-5" />
          </div>
          <div className="inline-flex items-center rounded-full bg-green-600/10 px-2 py-0.5 text-[9px] font-bold text-green-700">
            Live
          </div>
        </div>
        <div className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">
          {isNewProject ? "0" : projectKpiMock[3].value}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          Workers On Site Now
          <span className="flex items-center text-[10px] font-semibold text-green-600">
            <span className="mr-1 inline-block size-1.5 rounded-full bg-green-600" />
            GPS Active
          </span>
        </div>
      </div>
    </section>
  );
}
