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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MoreVertical, Square, Star } from "lucide-react";
import { currency } from "@/utils/formatters";
import { randomColourHexGenerator } from "@/utils/generator";
import { useRouter } from "next/navigation";

const convertCategoryToTradieType = (
  category: string,
): keyof typeof TRADIE_TYPES | null => {
  const entry = Object.entries(TRADIE_TYPES).find(
    ([, value]) => value === category,
  );

  return (entry?.[0] as keyof typeof TRADIE_TYPES) ?? null;
};

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
            icon={<Icon className="h-5 w-5" />}
            color={randomColourHexGenerator(category.category)}
            name={category.category}
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
  color: string; // hex color code
  name: string;
  tradieCount: number;
  tradies: TradieRow[];
}

function TradieCategoryAccordion({
  icon,
  color,
  name,
  tradieCount,
  tradies,
}: CategoryCardProps) {
  return (
    <AccordionItem value={name} className="rounded-xl border px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex w-full items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg"
            style={{
              color,
              backgroundColor: `${color}15`,
            }}
          >
            {icon}
          </div>
          <span className="font-semibold">{name}</span>

          <Badge variant="secondary" className="ml-auto mr-4">
            {tradieCount} tradies
          </Badge>
        </div>
      </AccordionTrigger>

      <AccordionContent>
        <div className="space-y-2 pb-2">
          {tradies.map((tradie) => (
            <TradieListItem key={tradie.id} tradie={tradie} color={color} />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function TradieListItem({
  tradie,
  color,
}: {
  tradie: TradieRow;
  color: string;
}) {
  const router = useRouter();
  const initials = tradie.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const handleClick = () => {
    router.push(`/tradie-management/${tradie.id}`);
  };

  return (
    <Card
      className="p-3 transition-colors hover:border-primary cursor-pointer"
      onClick={handleClick}
    >
      <div className="flex items-center gap-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{
            color,
            backgroundColor: `${color}15`,
          }}
        >
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{tradie.name}</p>

            {tradie.isFavourite && (
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            )}
          </div>

          <p className="text-sm text-muted-foreground">{tradie.trade}</p>
        </div>

        <div className="hidden min-w-20 text-center sm:block">
          <p className="font-semibold">
            {tradie.hourlyRate
              ? currency.format(parseFloat(tradie.hourlyRate))
              : "-"}
          </p>
          <p className="text-xs text-muted-foreground">/hr</p>
        </div>

        <div className="hidden min-w-15 text-center md:block">
          <p className="font-semibold">{tradie.jobsCompleted}</p>
          <p className="text-xs text-muted-foreground">jobs</p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
