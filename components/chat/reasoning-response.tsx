import { useState } from "react";
import type { ReasoningUIPart } from "ai";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronDown, Activity } from "lucide-react";
import remarkGfm from "remark-gfm";
import { Response } from "./response";

export function ReasoningResponse({ part }: { part: ReasoningUIPart }) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] shadow-sm">
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center gap-3 px-4 py-3 text-sm text-slate-600">
            <div className="flex size-7 items-center justify-center rounded-full border border-[#C6923A]/20 bg-[#C6923A]/10 font-semibold text-[#8B6420]">
              <Activity className="h-4 w-4" />
            </div>
            <div className="flex-1 text-left">
              <div className="font-medium text-slate-900">Reasoning</div>
              <div className="text-xs text-slate-500">
                Tap to {open ? "collapse" : "expand"}
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-slate-600 transition-transform duration-200 ${open ? "rotate-180" : "rotate-0"}`}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div
            className={`px-4 pb-4 text-sm text-slate-600 ${open ? "animate-fadeIn" : "animate-fadeOut"}`}
          >
            <Response remarkPlugins={[remarkGfm]}>{part.text}</Response>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
