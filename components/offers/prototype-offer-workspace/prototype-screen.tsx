"use client";

// PROTOTYPE — throwaway. Not imported by production code.

import { useSearchParams } from "next/navigation";
import { PrototypeVariant } from "./prototype-variants";
import { VARIANTS, VariantBar, type VariantId } from "./prototype-shell";

export function PrototypeScreen() {
  const params = useSearchParams();
  const raw = params.get("v");
  // "c" is the approved direction, so it is what /prototype opens on. The other
  // two stay reachable for comparison.
  const active: VariantId = VARIANTS.some((x) => x.id === raw)
    ? (raw as VariantId)
    : "c";
  const meta = VARIANTS.find((x) => x.id === active);

  return (
    <div className="pb-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-heading text-xl font-semibold tracking-[-0.015em]">
          Offer workspace — {meta?.name}
        </h1>
        <p className="text-sm text-muted-foreground">{meta?.blurb}</p>
      </div>
      {/* key: each variant owns independent in-memory state, so switching
          should reset rather than bleed across. */}
      <PrototypeVariant key={active} id={active} />
      <VariantBar active={active} />
    </div>
  );
}
