"use client";

import Link from "next/link";

type TopPageSelectorProps = {
  currentPage: "wall" | "random" | "scanner" | "stats";
};

const links = [
  { key: "wall", href: "/", label: "Wall" },
  { key: "random", href: "/random", label: "Random" },
  { key: "scanner", href: "/scanner", label: "Scanner" },
  { key: "stats", href: "/stats", label: "Stats" },
] as const;

export function TopPageSelector({ currentPage }: TopPageSelectorProps) {
  return (
    <nav className="flex flex-wrap gap-2 rounded-full border border-zinc-800 bg-black/25 p-2">
      {links.map((link) => {
        const isActive = link.key === currentPage;

        return (
          <Link
            key={link.key}
            href={link.href}
            className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] transition-colors ${
              isActive
                ? "bg-red-500 text-white shadow-[0_8px_24px_rgba(239,68,68,0.35)]"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}