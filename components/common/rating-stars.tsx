import { Star } from "lucide-react";

/**
 * Canonical read-only star rating. This absorbed the near-duplicate
 * `common/rating-star.tsx` (same render, no aria-label, "/5" suffix); use
 * `showOutOf` for that variant. For an editable rating see
 * `tradie-management/rating-input.tsx`.
 */
interface RatingStarsProps {
  rating: number; // 0-5 scale
  size?: number;
  /** Render the numeric value as "4.5/5" instead of "4.5". */
  showOutOf?: boolean;
}

export function RatingStars({
  rating,
  size = 16,
  showOutOf = false,
}: RatingStarsProps) {
  const clampedRating = Math.min(
    5,
    Math.max(0, Number.isFinite(rating) ? rating : 0),
  );

  return (
    <div
      className="flex items-center gap-0.5"
      role="img"
      aria-label={`Rating: ${clampedRating.toFixed(1)} out of 5`}
    >
      {Array.from({ length: 5 }).map((_, index) => {
        const fillPercentage = Math.max(
          0,
          Math.min(100, (clampedRating - index) * 100),
        );

        return (
          <div
            key={index}
            className="relative"
            style={{ width: size, height: size }}
            aria-hidden="true"
          >
            {/* Empty star */}
            <Star
              size={size}
              className="absolute inset-0 text-muted-foreground/40"
            />

            {/* Filled portion. Fill is a non-colour cue, so the rating stays
                legible for users who cannot distinguish the amber. */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fillPercentage}%` }}
            >
              <Star size={size} className="fill-warning text-warning" />
            </div>
          </div>
        );
      })}
      <span className="ml-2 text-xs font-medium tabular-nums text-muted-foreground">
        {clampedRating.toFixed(1)}
        {showOutOf ? "/5" : ""}
      </span>
    </div>
  );
}
