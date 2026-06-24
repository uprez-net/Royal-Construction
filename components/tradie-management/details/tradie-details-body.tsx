import { Building2, CalendarDays, Mail, Phone, Star } from "lucide-react";
import { dateFormat } from "@/utils/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppSelector } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { RatingStars } from "@/components/common/rating-star";

export function TradieBusinessDetailsCard() {
  const tradieDetails = useAppSelector(
    (state) => state.tradieManagement.selectedTradieDetails,
  );
  if (!tradieDetails) {
    return null;
  }
  const details = [
    {
      label: "Phone",
      value: tradieDetails.phone,
      icon: Phone,
    },
    {
      label: "Email",
      value: tradieDetails.email,
      icon: Mail,
    },
    {
      label: "ABN",
      value: tradieDetails.abn,
      icon: Building2,
    },
    {
      label: "Joined",
      value: dateFormat.format(tradieDetails.createdAt),
      icon: CalendarDays,
    },
  ];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Contact & Business Details</CardTitle>
      </CardHeader>

      <CardContent className="space-y-6 mt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {details.map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.label}>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </div>

                <div className="wrap-break-word text-sm font-medium">
                  {item.value}
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

export function TradiePriorityCard() {
  const tradieDetails = useAppSelector(
    (state) => state.tradieManagement.selectedTradieDetails,
  );

  if (!tradieDetails) {
    return null;
  }

  const { rating, hourlyRate, jobsCompleted } = tradieDetails;

  const handleRatingChange = () => {
    // Handle rating change logic here
  };

  return (
    <Card className="h-full">
      <CardContent className="space-y-4 text-center">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Current Ratings
          </div>

          <div className="mt-3 flex items-center justify-center gap-1 text-2xl font-bold">
            <RatingStars rating={parseFloat(rating ?? "0")} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Hourly Rate</div>

            <div className="text-lg font-bold">${hourlyRate}</div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Total Jobs</div>

            <div className="text-lg font-bold">{jobsCompleted}</div>
          </div>
        </div>

        <Button
          className="w-full bg-amber-500 hover:bg-amber-600 text-white"
          variant="secondary"
          onClick={handleRatingChange}
        >
          <Star className="mr-2 h-4 w-4" />
          Set Ratings
        </Button>
      </CardContent>
    </Card>
  );
}
