"use client";

import { createElement } from "react";

import { FALLBACK_TRADE_ICON, TRADE_ICONS } from "@/constants/tradieTypes";
import { findTradeType, useTradeTypes } from "@/hooks/use-trade-types";
import type { TradeIconKey } from "@/types/trade-type";

type IconProps = { className?: string };

/** The glyph for an icon key, as Admin → Trade types stores it. */
export function TradeIconGlyph({
  icon,
  className,
}: IconProps & { icon: TradeIconKey | null | undefined }) {
  return createElement(icon ? TRADE_ICONS[icon] : FALLBACK_TRADE_ICON, {
    className,
    "aria-hidden": true,
  });
}

/**
 * The icon for a trade, by its label ("Plumbing"). A label the list does not
 * have — an archived trade, "Others" — gets the fallback glyph.
 */
export function TradeIcon({
  trade,
  className,
}: IconProps & { trade: string | null | undefined }) {
  const { tradeTypes } = useTradeTypes();
  return (
    <TradeIconGlyph
      icon={findTradeType(tradeTypes, trade)?.icon}
      className={className}
    />
  );
}
