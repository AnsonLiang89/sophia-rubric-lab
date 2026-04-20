import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "default" | "amber" | "moss" | "clay";
}

export default function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  right,
  children,
  className,
  tone = "default",
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const toneBg = {
    default: "bg-white border-paper-200",
    amber: "bg-amber-soft/30 border-amber/30",
    moss: "bg-moss/5 border-moss/30",
    clay: "bg-clay/5 border-clay/30",
  }[tone];

  return (
    <div className={clsx("rounded-xl border shadow-soft overflow-hidden", toneBg, className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-paper-100/40 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-ink-900 flex items-center gap-2">
            <svg
              className={clsx(
                "w-4 h-4 text-ink-500 transition-transform duration-200",
                open && "rotate-90"
              )}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M7 5l6 5-6 5V5z" />
            </svg>
            {title}
          </div>
          {subtitle && <div className="mt-1 text-sm text-ink-500 pl-6">{subtitle}</div>}
        </div>
        {right && <div onClick={(e) => e.stopPropagation()}>{right}</div>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-1 border-t border-paper-200">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
