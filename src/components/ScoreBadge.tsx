import clsx from "clsx";
import { scoreColor } from "../lib/score";

export default function ScoreBadge({
  score,
  size = "md",
  showMax = true,
}: {
  score: number;
  size?: "sm" | "md" | "lg";
  showMax?: boolean;
}) {
  const sz = {
    sm: "text-sm px-2 py-0.5",
    md: "text-base px-2.5 py-1",
    lg: "text-2xl px-3 py-1.5 font-bold",
  }[size];
  return (
    <span
      className={clsx(
        "inline-flex items-baseline gap-0.5 rounded-md font-semibold tabular-nums",
        sz,
        scoreColor(score),
        "bg-paper-100"
      )}
    >
      {score.toFixed(score % 1 === 0 ? 1 : 2)}
      {showMax && <span className="text-xs text-ink-500 font-normal">/10</span>}
    </span>
  );
}
