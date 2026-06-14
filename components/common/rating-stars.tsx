import { Star } from "lucide-react";

interface RatingStarsProps {
  rating: number; // 0-5 scale
  size?: number;
}

export function RatingStars({
  rating,
  size = 16,
}: RatingStarsProps) {
  const clampedRating = Math.min(5, Math.max(0, rating));

  return (
    <div
      className="flex items-center gap-0.5"
      aria-label={`Rating: ${clampedRating.toFixed(1)} out of 5`}
    >
      {Array.from({ length: 5 }).map((_, index) => {
        const fillPercentage = Math.max(
          0,
          Math.min(100, (clampedRating - index) * 100)
        );

        return (
          <div
            key={index}
            className="relative"
            style={{ width: size, height: size }}
          >
            {/* Empty star */}
            <Star
              size={size}
              className="absolute inset-0 text-muted-foreground/30"
            />

            {/* Filled portion */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fillPercentage}%` }}
            >
              <Star
                size={size}
                className="fill-yellow-400 text-yellow-400"
              />
            </div>
          </div>
        );
      })}
      <span className="text-xs font-medium text-muted-foreground ml-2">
        {rating.toFixed(1)}
      </span>
    </div>
  );
}
