import { Star } from "lucide-react";

export function RatingStars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center">
        {Array.from({ length: 5 }).map((_, i) => {
          const fillPercentage = Math.max(
            0,
            Math.min(100, (rating - i) * 100),
          );

          return (
            <div key={i} className="relative">
              {/* Empty star */}
              <Star className="size-4 text-muted-foreground/40" />

              {/* Filled portion */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fillPercentage}%` }}
              >
                <Star className="size-4 fill-yellow-400 text-yellow-400" />
              </div>
            </div>
          );
        })}
      </div>

      <span className="text-sm text-muted-foreground">
        {rating.toFixed(1)}/5
      </span>
    </div>
  );
}