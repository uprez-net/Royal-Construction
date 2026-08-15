import { TradieRow, TradiesByCategory } from "@/types/tradie";
import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setSelectedCategory } from "@/lib/store/slices/tradieManagementSlice";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Square, Star } from "lucide-react";
import { rateCurrency } from "@/utils/formatters";
import {
  TRADE_AVATAR_CLASS,
  TRADE_ICON_TILE_CLASS,
} from "@/constants/tradeChip";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TradieActionsDropdown } from "../tradie-actions";
import {
  convertCategoryToTradieType,
  type TradieType,
} from "@/utils/normalize-tradie-type";

export function TradieList({
  filteredTradies,
}: {
  filteredTradies: TradiesByCategory[];
}) {
  const dispatch = useAppDispatch();
  const { selectedCategory } = useAppSelector(
    (state) => state.tradieManagement,
  );

  const handleActionClick = (category: string) => {
    if (category === selectedCategory) {
      dispatch(setSelectedCategory(null));
    } else {
      dispatch(setSelectedCategory(category));
    }
  };

  return (
    <Accordion
      type="single"
      collapsible
      className="w-full space-y-4"
      value={selectedCategory ?? undefined}
      onValueChange={(value) => handleActionClick(value)}
    >
      {filteredTradies.map((category) => {
        const Icon =
          TRADIE_TYPE_ICONS[convertCategoryToTradieType(category.category)!] ??
          Square;

        return (
          <TradieCategoryAccordion
            key={category.category}
            icon={<Icon className="size-5" aria-hidden="true" />}
            name={
              TRADIE_TYPES[category.category as TradieType] ??
              category.category
            }
            tradieCount={category.tradies.length}
            tradies={category.tradies}
          />
        );
      })}
    </Accordion>
  );
}

interface CategoryCardProps {
  icon: React.ReactNode;
  name: string;
  tradieCount: number;
  tradies: TradieRow[];
}

function TradieCategoryAccordion({
  icon,
  name,
  tradieCount,
  tradies,
}: CategoryCardProps) {
  return (
    <AccordionItem
      value={name}
      className="rounded-lg border border-border/70 bg-card px-4 shadow-sm"
    >
      <AccordionTrigger className="hover:no-underline">
        <div className="flex w-full items-center gap-3">
          {/* Icon carries trade identity; see constants/tradeChip.ts. */}
          <div className={cn(TRADE_ICON_TILE_CLASS, "size-10")}>{icon}</div>
          <span className="font-medium text-foreground">{name}</span>

          <Badge variant="secondary" className="ml-auto mr-4">
            {tradieCount} tradie{tradieCount === 1 ? "" : "s"}
          </Badge>
        </div>
      </AccordionTrigger>

      <AccordionContent>
        <div className="space-y-2 pb-2">
          {tradies.map((tradie) => (
            <TradieListItem key={tradie.id} tradie={tradie} />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function TradieListItem({ tradie }: { tradie: TradieRow }) {
  const router = useRouter();
  const initials = tradie.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const rate =
    tradie.lastQuotedPrice !== null && Number.isFinite(parseFloat(tradie.lastQuotedPrice))
      ? rateCurrency.format(parseFloat(tradie.lastQuotedPrice))
      : "—";

  // The row also holds an actions menu, so the wrapper must not be a button
  // (spec §3): the keyboard path is the name link, and the row click is a
  // mouse-only convenience over the same destination.
  const handleClick = () => {
    router.push(`/tradie-management/${tradie.id}`);
  };

  return (
    <Card
      className="cursor-pointer p-3 transition-colors hover:bg-muted/40"
      onClick={handleClick}
    >
      <div className="flex items-center gap-4">
        <div className={cn(TRADE_AVATAR_CLASS, "size-10 text-sm")}>
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/tradie-management/${tradie.id}`}
              className="truncate font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {tradie.name}
            </Link>

            {tradie.isFavourite && (
              <Star
                className="size-4 shrink-0 fill-warning text-warning"
                role="img"
                aria-label="Favourite"
              />
            )}
          </div>

          <p className="text-sm text-muted-foreground">{tradie.trade}</p>
        </div>

        <div className="hidden min-w-20 text-center sm:block">
          <p className="font-mono text-sm font-medium tabular-nums text-foreground">
            {rate}
          </p>
        </div>

        <div className="hidden min-w-15 text-center md:block">
          <p className="text-sm font-medium tabular-nums text-foreground">
            {tradie.jobsCompleted}
          </p>
          <p className="text-xs text-muted-foreground">jobs</p>
        </div>

        {/* The dropdown stops propagation on its own trigger and renders its
            menu in a portal, so opening it never triggers the row click. */}
        <TradieActionsDropdown tradieRow={tradie} />
      </div>
    </Card>
  );
}
