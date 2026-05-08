"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TopPageSelector } from "../../components/TopPageSelector";
import { calculateListeningStreak, type ListeningEntry } from "../../lib/collectionExtras";

type CountRow = {
  label: string;
  count: number;
};

function toRows(items: string[]): CountRow[] {
  const map = new Map<string, number>();
  items.forEach((item) => map.set(item, (map.get(item) || 0) + 1));
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<ListeningEntry[]>([]);

  const loadEntries = useCallback(async () => {
    const res = await fetch("/api/listening-history");
    if (res.ok) setEntries(await res.json());
  }, []);

  useEffect(() => {
    loadEntries();
    const sync = () => loadEntries();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [loadEntries]);

  const streak = useMemo(() => calculateListeningStreak(entries), [entries]);
  const topArtists = useMemo(() => toRows(entries.map((e) => e.artist || "Unknown artist")).slice(0, 8), [entries]);

  const monthCount = useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    return entries.filter((entry) => {
      const d = new Date(entry.playedAt);
      return d.getMonth() === month && d.getFullYear() === year;
    }).length;
  }, [entries]);

  const noRepeatCount = useMemo(() => {
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(`${entry.title}|||${entry.artist}`);
    }
    return seen.size;
  }, [entries]);

  return (
    <main className="flex flex-col flex-1 page-shell fade-in">
      <div className="hero-card px-4 py-5 md:px-6 md:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="h-10 w-[3px] bg-red-500 rounded" />
              <p className="text-xs md:text-sm uppercase tracking-[0.35em] subtle">Playback Journal</p>
            </div>
            <h1 className="hero-title">
              Listening <span className="hero-accent">History</span>
            </h1>
            <p className="text-sm subtle mt-2">Track recent plays, monthly activity, and your current listening streak.</p>
          </div>
          <TopPageSelector currentPage="history" />
        </div>
      </div>

      <section className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="text-xs uppercase tracking-widest subtle">Total plays</p>
          <p className="mt-2 text-2xl font-bold">{entries.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="text-xs uppercase tracking-widest subtle">This month</p>
          <p className="mt-2 text-2xl font-bold">{monthCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="text-xs uppercase tracking-widest subtle">Unique records</p>
          <p className="mt-2 text-2xl font-bold">{noRepeatCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="text-xs uppercase tracking-widest subtle">Current streak</p>
          <p className="mt-2 text-2xl font-bold">{streak} day(s)</p>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="panel p-4">
          <h2 className="text-lg font-semibold">Top artists</h2>
          {topArtists.length === 0 ? (
            <p className="subtle mt-3 text-sm">No listens logged yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {topArtists.map((row) => (
                <li key={row.label} className="flex items-center justify-between text-sm">
                  <span>{row.label}</span>
                  <span className="subtle">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel p-4">
          <h2 className="text-lg font-semibold">Recent listens</h2>
          {entries.length === 0 ? (
            <p className="subtle mt-3 text-sm">No history yet. Use the log buttons in Wall or Random.</p>
          ) : (
            <ul className="mt-3 space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {entries.map((entry) => (
                <li key={entry.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="font-medium">{entry.title}</p>
                  <p className="text-sm subtle">{entry.artist || "Unknown artist"}</p>
                  <p className="text-xs subtle mt-1">{formatDate(entry.playedAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
