import clsx from "clsx";
import { ISSUE_TAGS, type IssueTagId } from "../types";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-clay/15 text-clay border-clay/30",
  high: "bg-ochre/15 text-ochre border-ochre/30",
  medium: "bg-amber-soft text-amber-dark border-amber/30",
  low: "bg-paper-200 text-ink-700 border-paper-300",
  positive: "bg-moss/15 text-moss border-moss/30",
};

export default function IssueTag({
  id,
  onRemove,
}: {
  id: IssueTagId;
  onRemove?: () => void;
}) {
  const tag = ISSUE_TAGS.find((t) => t.id === id);
  if (!tag) return null;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        SEVERITY_STYLE[tag.severity]
      )}
    >
      {tag.label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100"
          aria-label="移除标签"
        >
          ×
        </button>
      )}
    </span>
  );
}
