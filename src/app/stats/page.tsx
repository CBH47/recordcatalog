"use client";

import React, { useEffect, useMemo, useState } from "react";
import { TopPageSelector } from "../../components/TopPageSelector";
import { supabase } from "../../lib/supabaseClient";

type StatsRecord = {
  id: number;
  title: string;
  cubby: number | null;
  image_url?: string;
  on_my_wall: boolean;
  out_for_the_day: boolean;
  genre: string;
  artists: string[];
};

type CountRow = {
  label: string;
  count: number;
};

function hasUsableImage(imageUrl?: string): boolean {
  const clean = String(imageUrl || "").trim().toLowerCase();
  if (!clean) return false;
  if (clean.includes("spacer.gif")) return false;
  return clean.startsWith("http://") || clean.startsWith("https://");
}

function toCountRows(values: string[]): CountRow[] {
  const map = new Map<string, number>();

  values.filter(Boolean).forEach((value) => {
    map.set(value, (map.get(value) || 0) + 1);
  });

  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function StatList({ title, rows }: { title: string; rows: CountRow[] }) {
  const max = rows[0]?.count || 1;

  return (
    <section className="panel p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm subtle">No data yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => {
            const pct = Math.max(6, Math.round((row.count / max) * 100));
            return (
              <li key={row.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium truncate pr-2">{row.label}</span>
                  <span className="subtle">{row.count}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden">
                  <div className="h-full bg-red-500" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function StatsPage() {
  const [records, setRecords] = useState<StatsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRecords = async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("records")
        .select("id,title,cubby,image_url,on_my_wall,out_for_the_day,genre:genres(name),artists(name)");

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const mapped = (data || []).map((rec: any) => ({
        id: rec.id,
        title: rec.title || "",
        cubby: rec.cubby ?? null,
        image_url: rec.image_url || "",
        on_my_wall: Boolean(rec.on_my_wall),
        out_for_the_day: Boolean(rec.out_for_the_day),
        genre: rec.genre?.name || "",
        artists: rec.artists ? rec.artists.map((a: any) => a.name).filter(Boolean) : [],
      }));

      setRecords(mapped);
      setLoading(false);
    };

    fetchRecords();
  }, []);

  const total = records.length;
  const wallCount = useMemo(() => records.filter((r) => r.on_my_wall).length, [records]);
  const outCount = useMemo(() => records.filter((r) => r.out_for_the_day).length, [records]);
  const coverCount = useMemo(() => records.filter((r) => hasUsableImage(r.image_url)).length, [records]);
  const uniqueArtistCount = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => r.artists.forEach((a) => set.add(a)));
    return set.size;
  }, [records]);
  const uniqueGenreCount = useMemo(
    () => new Set(records.map((r) => r.genre).filter(Boolean)).size,
    [records]
  );

  const topGenres = useMemo(() => toCountRows(records.map((r) => r.genre)).slice(0, 8), [records]);
  const topArtists = useMemo(() => toCountRows(records.flatMap((r) => r.artists)).slice(0, 8), [records]);
  const cubbyRows = useMemo(
    () =>
      toCountRows(
        records.map((r) => (r.cubby === null ? "Unassigned" : `Cubby ${r.cubby}`))
      ).slice(0, 12),
    [records]
  );

  return (
    <main className="flex flex-col flex-1 page-shell fade-in">
      <div className="hero-card px-4 py-5 md:px-6 md:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="h-10 w-[3px] bg-red-500 rounded" />
              <p className="text-xs md:text-sm uppercase tracking-[0.35em] subtle">Collection Analytics</p>
            </div>
            <h1 className="hero-title">
              Record <span className="hero-accent">Statistics</span>
            </h1>
            <p className="text-sm subtle mt-2">A live snapshot of your collection size, coverage, and distribution.</p>
          </div>
          <TopPageSelector currentPage="stats" />
        </div>
      </div>

      <div className="mt-4 panel p-4">
        {loading ? (
          <div className="subtle">Loading statistics...</div>
        ) : error ? (
          <div className="text-red-400">Error: {error}</div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-widest subtle">Total records</p>
                <p className="mt-2 text-2xl font-bold">{total}</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-widest subtle">On wall</p>
                <p className="mt-2 text-2xl font-bold">{wallCount}</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-widest subtle">Out today</p>
                <p className="mt-2 text-2xl font-bold">{outCount}</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-widest subtle">With cover</p>
                <p className="mt-2 text-2xl font-bold">{coverCount}</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-widest subtle">Artists</p>
                <p className="mt-2 text-2xl font-bold">{uniqueArtistCount}</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-widest subtle">Genres</p>
                <p className="mt-2 text-2xl font-bold">{uniqueGenreCount}</p>
              </div>
            </section>

            <section className="mt-4 grid gap-4 lg:grid-cols-3">
              <StatList title="Top Genres" rows={topGenres} />
              <StatList title="Top Artists" rows={topArtists} />
              <StatList title="Cubby Distribution" rows={cubbyRows} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
