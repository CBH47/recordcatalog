"use client";

import Link from "next/link";

type TopPageSelectorProps = {
  currentPage: "wall" | "random" | "scanner" | "stats" | "wishlist" | "history";
};

const links = [
  { key: "wall", href: "/", label: "Wall" },
  { key: "random", href: "/random", label: "Random" },
  { key: "scanner", href: "/scanner", label: "Scanner" },
  { key: "stats", href: "/stats", label: "Stats" },
  { key: "wishlist", href: "/wishlist", label: "Wishlist" },
  { key: "history", href: "/history", label: "History" },
] as const;

export function TopPageSelector({ currentPage }: TopPageSelectorProps) {
  return (
    <nav className="chip-scrollbar flex flex-nowrap gap-2 overflow-x-auto rounded-full border border-zinc-800 bg-black/25 p-2">
      {links.map((link) => {
        const isActive = link.key === currentPage;

        return (
          <Link
            key={link.key}
            href={link.href}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] transition-colors ${
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