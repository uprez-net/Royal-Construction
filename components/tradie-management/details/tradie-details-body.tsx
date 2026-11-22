import {
  Building2,
  CalendarDays,
  Mail,
  MapPin,
  Phone,
  Star,
} from "lucide-react";
import { rateCurrency, dateFormat } from "@/utils/formatters";
import { tradieTrades } from "@/lib/domain/tradies/request-rules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { RatingStars } from "@/components/common/rating-stars";
import { openModal } from "@/lib/store/slices/uiSlice";
import { TradieRow } from "@/types/tradie";
import { formatQuotedPrice } from "@/utils/calculations";

type DetailItem = {
  label: string;
  icon: typeof Phone;
  /** Rendered value. */
  content: React.ReactNode;
};

export function TradieBusinessDetailsCard() {
  const tradieDetails = useAppSelector(
    (state) => state.tradieManagement.selectedTradieDetails,
  );
  if (!tradieDetails) {
    return null;
  }

  const details: DetailItem[] = [
    {
      label: "Phone",
      icon: Phone,
      content: (
        // Calling a tradie is the primary job of this page, so the number is a
        // real tel: link rather than inert text.
        <a
          href={`tel:${tradieDetails.phone.replace(/[^\d+]/g, "")}`}
          className="font-mono tabular-nums text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {tradieDetails.phone}
        </a>
      ),
    },
    {
      label: "Email",
      icon: Mail,
      content: (
        <a
          href={`mailto:${tradieDetails.email}`}
          className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {tradieDetails.email}
        </a>
      ),
    },
    {
      label: "Additional Emails",
      icon: Mail,
      content: (
        <div className="space-y-1 flex flex-col">
          {tradieDetails.additionalEmails?.map((email) => (
            <a
              key={email}
              href={`mailto:${email}`}
              className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {email}
            </a>
          ))}
        </div>
      ),
    },
    {
      label: "Location",
      icon: MapPin,
      content: tradieDetails.location ?? "Not recorded",
    },
    {
      label: "ABN",
      icon: Building2,
      content: (
        <span className="font-mono tabular-nums">{tradieDetails.abn}</span>
      ),
    },
    {
      label: "Joined",
      icon: CalendarDays,
      content: (
        <span className="font-mono tabular-nums">
          {dateFormat.format(tradieDetails.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle as="h2">Contact and business details</CardTitle>
      </CardHeader>

      <CardContent className="mt-4 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {details.map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.label}>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {item.label}
                </div>

                <div className="wrap-break-word text-sm font-medium">
                  {item.content}
                </div>
              </div>
            );
          })}
        </div>

        {tradieDetails.note && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Notes
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground">
              {tradieDetails.note}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TradiePriorityCard({ isOffice }: { isOffice: boolean }) {
  const dispatch = useAppDispatch();
  const tradieDetails = useAppSelector(
    (state) => state.tradieManagement.selectedTradieDetails,
  );

  if (!tradieDetails) {
    return null;
  }

  const { rating, lastQuotedPrice, jobsCompleted } = tradieDetails;
  const lastQuotedPriceValue =
    lastQuotedPrice == null ? null : Number(lastQuotedPrice);
  // `null` when there is no rate, so the render can keep mono for facts and use
  // prose for the placeholder. Previously this returned the string "Not set"
  // into a `font-mono tabular-nums` slot, so a missing value read like data.
  const lastQuotedPriceLabel =
    lastQuotedPriceValue == null || Number.isNaN(lastQuotedPriceValue)
      ? null
      : formatQuotedPrice(
          lastQuotedPriceValue,
          tradieDetails.lastQuotedPriceUnit,
          rateCurrency.format,
        );

  const handleRatingChange = () => {
    const tradieRow = {
      id: tradieDetails.id,
      name: tradieDetails.name,
      trade: tradieDetails.trade,
      trades: tradieTrades(tradieDetails),
      isFavourite: tradieDetails.isFavourite,
      lastQuotedPrice: tradieDetails.lastQuotedPrice ?? null,
      lastQuotedPriceUnit: tradieDetails.lastQuotedPriceUnit,
      rating: tradieDetails.rating ?? null,
      jobsCompleted: tradieDetails.jobsCompleted,
      incidentCount: {
        open: tradieDetails.incidents.filter(
          (incident) => incident.status === "OPEN",
        ).length,
        resolved: tradieDetails.incidents.filter(
          (incident) => incident.status === "RESOLVED",
        ).length,
      },
    } satisfies TradieRow;
    dispatch(openModal({ type: "rateTradie", payload: { tradie: tradieRow } }));
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle as="h2">Performance</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Current rating
          </div>

          <div className="mt-2 flex items-center gap-1">
            <RatingStars rating={parseFloat(rating ?? "0")} showOutOf />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {isOffice && (
            <div>
              <div className="text-xs text-muted-foreground">
                Last quoted price
              </div>

              {lastQuotedPriceLabel ? (
                <div className="font-mono text-lg font-semibold tabular-nums">
                  {lastQuotedPriceLabel}
                </div>
              ) : (
                <div className="text-lg font-semibold text-muted-foreground">
                  Not set
                </div>
              )}
            </div>
          )}

          <div>
            <div className="text-xs text-muted-foreground">Total jobs</div>

            <div className="text-lg font-semibold font-mono tabular-nums">
              {jobsCompleted}
            </div>
          </div>
        </div>

        <Button className="w-full" onClick={handleRatingChange}>
          <Star className="mr-2 h-4 w-4" aria-hidden="true" />
          Set rating
        </Button>
      </CardContent>
    </Card>
  );
}
