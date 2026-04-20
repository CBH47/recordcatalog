"use client";

import Link from "next/link";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { TopPageSelector } from "../../components/TopPageSelector";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

type RandomRecord = {
  id: number;
  title: string;
  artists: string[];
  genre: string;
  subgenre: string;
  cubby: number | null;
  image_url?: string;
  on_my_wall: boolean;
  out_for_the_day: boolean;
  discogs_id?: string | null;
};

type FilterMode = "only" | "exclude";

const RECENT_STORAGE_KEY = "recordcatalog_recent_random_ids";
const RECENT_MAX = 25;

function pickRandom<T>(items: T[]): T | null {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function hasUsableImage(imageUrl?: string): boolean {
  const clean = String(imageUrl || "").trim().toLowerCase();
  if (!clean) return false;
  if (clean.includes("spacer.gif")) return false;
  return clean.startsWith("http://") || clean.startsWith("https://");
}

function RandomPickerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [records, setRecords] = useState<RandomRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [genreParam, setGenreParam] = useState(searchParams?.get("genre") || "");
  const [mode, setMode] = useState<FilterMode>(searchParams?.get("mode") === "exclude" ? "exclude" : "only");
  const [subgenreParam, setSubgenreParam] = useState(searchParams?.get("subgenre") || "");
  const [onlyOnWall, setOnlyOnWall] = useState(searchParams?.get("onWall") === "1");
  const [excludeOutForDay, setExcludeOutForDay] = useState(searchParams?.get("excludeOut") === "1");
  const [requireCoverArt, setRequireCoverArt] = useState(searchParams?.get("cover") === "1");

  const [avoidRecent, setAvoidRecent] = useState(true);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const [picked, setPicked] = useState<RandomRecord | null>(null);

  const [queueSize, setQueueSize] = useState(5);
  const [queue, setQueue] = useState<RandomRecord[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecentIds(parsed.filter((n) => Number.isInteger(n)).slice(0, RECENT_MAX));
        }
      }
    } catch {
      // Ignore malformed local storage data.
    }
  }, []);

  const pushRecent = (id: number) => {
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_MAX);
      try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  };

  useEffect(() => {
    const fetchRecords = async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("records")
        .select("id,title,cubby,image_url,on_my_wall,out_for_the_day,discogs_id,genre:genres(name),subgenre:subgenres(name),artists(name)")
        .order("title", { ascending: true });

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const mapped = (data || []).map((rec: any) => ({
        id: rec.id,
        title: rec.title || "",
        genre: rec.genre?.name || "",
        subgenre: rec.subgenre?.name || "",
        cubby: rec.cubby ?? null,
        artists: rec.artists ? rec.artists.map((a: any) => a.name) : [],
        image_url: rec.image_url || "",
        on_my_wall: Boolean(rec.on_my_wall),
        out_for_the_day: Boolean(rec.out_for_the_day),
        discogs_id: rec.discogs_id || null,
      }));

      setRecords(mapped);
      setLoading(false);
    };

    fetchRecords();
  }, []);

  useEffect(() => {
    const current = searchParams?.toString() || "";
    const params = new URLSearchParams(current);

    if (genreParam) params.set("genre", genreParam);
    else params.delete("genre");

    if (subgenreParam) params.set("subgenre", subgenreParam);
    else params.delete("subgenre");

    params.set("mode", mode);

    if (onlyOnWall) params.set("onWall", "1");
    else params.delete("onWall");

    if (excludeOutForDay) params.set("excludeOut", "1");
    else params.delete("excludeOut");

    if (requireCoverArt) params.set("cover", "1");
    else params.delete("cover");

    const next = params.toString();
    if (next !== current) {
      router.replace(`/random?${next}`);
    }
  }, [genreParam, subgenreParam, mode, onlyOnWall, excludeOutForDay, requireCoverArt, router, searchParams]);

  const genres = useMemo(() => {
    const unique = Array.from(new Set(records.map((r) => r.genre).filter(Boolean)));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [records]);

  const subgenres = useMemo(() => {
    const source = genreParam
      ? records.filter((r) => r.genre.toLowerCase() === genreParam.toLowerCase())
      : records;
    const unique = Array.from(new Set(source.map((r) => r.subgenre).filter(Boolean)));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [records, genreParam]);

  const filtered = useMemo(() => {
    const genreNeedle = genreParam.toLowerCase();
    const subgenreNeedle = subgenreParam.toLowerCase();

    return records.filter((r) => {
      if (genreParam) {
        const genreMatches = r.genre.toLowerCase() === genreNeedle;
        if (mode === "only" && !genreMatches) return false;
        if (mode === "exclude" && genreMatches) return false;
      }

      if (subgenreParam && r.subgenre.toLowerCase() !== subgenreNeedle) return false;
      if (onlyOnWall && !r.on_my_wall) return false;
      if (excludeOutForDay && r.out_for_the_day) return false;
      if (requireCoverArt && !hasUsableImage(r.image_url)) return false;
      return true;
    });
  }, [records, genreParam, mode, subgenreParam, onlyOnWall, excludeOutForDay, requireCoverArt]);

  const eligible = useMemo(() => {
    if (!avoidRecent) return filtered;
    const reduced = filtered.filter((r) => !recentIds.includes(r.id));
    return reduced.length > 0 ? reduced : filtered;
  }, [filtered, avoidRecent, recentIds]);

  const handlePickRandom = () => {
    const choice = pickRandom(eligible);
    setPicked(choice);
    if (choice) pushRecent(choice.id);
  };

  const handleBuildQueue = () => {
    const source = shuffle(eligible);
    const size = Math.min(Math.max(queueSize, 1), 20);
    const nextQueue = source.slice(0, size);
    setQueue(nextQueue);
    if (!picked && nextQueue[0]) {
      setPicked(nextQueue[0]);
      pushRecent(nextQueue[0].id);
    }
  };

  const handlePlayNextFromQueue = () => {
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    setPicked(next);
    pushRecent(next.id);
    setQueue(rest);
  };

  const clearRecent = () => {
    setRecentIds([]);
    try {
      localStorage.removeItem(RECENT_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  };

  return (
    <main className="flex flex-col flex-1 page-shell fade-in">
      <div className="hero-card px-4 py-5 md:px-6 md:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="h-10 w-[3px] bg-red-500 rounded" />
              <p className="text-xs md:text-sm uppercase tracking-[0.35em] subtle">Playback Engine</p>
            </div>
            <h1 className="hero-title">
              Random <span className="hero-accent">Selector</span>
            </h1>
            <p className="text-sm subtle mt-2">Generate a queue, avoid repeats, and apply advanced filters to control the spin.</p>
          </div>
          <TopPageSelector currentPage="random" />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[160px_1fr_1fr]">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as FilterMode)}
              className="field"
            >
              <option value="only">Only this genre</option>
              <option value="exclude">Not this genre</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Genre (optional)</label>
            <select
              value={genreParam}
              onChange={(e) => {
                setGenreParam(e.target.value);
                setSubgenreParam("");
              }}
              className="field"
            >
              <option value="">Any genre</option>
              {genres.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Subgenre (optional)</label>
            <select
              value={subgenreParam}
              onChange={(e) => setSubgenreParam(e.target.value)}
              className="field"
            >
              <option value="">Any subgenre</option>
              {subgenres.map((sg) => (
                <option key={sg} value={sg}>{sg}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm subtle">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={onlyOnWall} onChange={(e) => setOnlyOnWall(e.target.checked)} />
            Only on my wall
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={excludeOutForDay} onChange={(e) => setExcludeOutForDay(e.target.checked)} />
            Exclude out for the day
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={requireCoverArt} onChange={(e) => setRequireCoverArt(e.target.checked)} />
            Cover art only
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={avoidRecent} onChange={(e) => setAvoidRecent(e.target.checked)} />
            Avoid recently played
          </label>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[200px_auto_auto_auto] items-end">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Queue size</label>
            <input
              type="number"
              min={1}
              max={20}
              value={queueSize}
              onChange={(e) => setQueueSize(Number(e.target.value) || 1)}
              className="field"
            />
          </div>

          <button
            onClick={handleBuildQueue}
            disabled={loading || eligible.length === 0}
            className="btn btn-primary"
          >
            Build queue
          </button>

          <button
            onClick={handlePickRandom}
            disabled={loading || eligible.length === 0}
            className="btn btn-secondary"
          >
            Pick single random
          </button>

          <button
            onClick={handlePlayNextFromQueue}
            disabled={queue.length === 0}
            className="btn btn-secondary"
          >
            Play next from queue
          </button>
        </div>

        {!loading && (
          <p className="mt-2 text-xs subtle">
            Candidates: {eligible.length} / {records.length} total. Recently played tracked: {recentIds.length}.
            {" "}
            <button onClick={clearRecent} className="underline hover:text-white">
              Clear recent
            </button>
          </p>
        )}
      </div>

      <div className="flex-1 mt-4 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section>
          <h2 className="text-lg font-semibold mb-3">Now spinning</h2>
          {loading ? (
            <div className="subtle">Loading records...</div>
          ) : error ? (
            <div className="text-red-400">Error: {error}</div>
          ) : eligible.length === 0 ? (
            <div className="subtle">No records match the current filters.</div>
          ) : picked ? (
            <div className="max-w-2xl panel p-5">
              <div className="flex flex-col md:flex-row gap-5">
                {hasUsableImage(picked.image_url) ? (
                  <img src={picked.image_url} alt={picked.title} className="w-40 h-40 object-cover rounded-md border border-zinc-700" />
                ) : (
                  <div className="w-40 h-40 rounded-md border border-zinc-700 bg-zinc-900 flex items-center justify-center text-xs subtle">
                    No cover art
                  </div>
                )}

                <div>
                  <p className="text-xs uppercase tracking-wide subtle">Now spinning</p>
                  <h3 className="text-2xl font-bold mt-1">{picked.title}</h3>
                  <p className="mt-2">{picked.artists.join(", ") || "Unknown artist"}</p>
                  <p className="mt-2 text-sm subtle">
                    {picked.genre || "Unknown genre"}
                    {picked.subgenre ? ` / ${picked.subgenre}` : ""}
                  </p>
                  <p className="mt-1 text-sm subtle">Cubby: {picked.cubby === null ? "Unassigned" : picked.cubby}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {picked.genre && (
                      <Link
                        href={`/genres/${encodeURIComponent(picked.genre)}`}
                        className="pill-nav"
                      >
                        Genre page
                      </Link>
                    )}
                    {picked.artists[0] && (
                      <Link
                        href={`/artists/${encodeURIComponent(picked.artists[0])}`}
                        className="pill-nav"
                      >
                        Artist page
                      </Link>
                    )}
                    {picked.discogs_id && (
                      <a
                        href={`https://www.discogs.com/release/${picked.discogs_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pill-nav"
                      >
                        Open Discogs
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="subtle">Build a queue or pick a random record.</div>
          )}
        </section>

        <aside>
          <h2 className="text-lg font-semibold mb-3">Next up queue</h2>
          {queue.length === 0 ? (
            <div className="subtle text-sm">Queue is empty. Click Build queue.</div>
          ) : (
            <ul className="space-y-2">
              {queue.map((rec, idx) => (
                <li key={rec.id} className="panel p-3">
                  <div className="text-xs subtle">#{idx + 1}</div>
                  <button
                    onClick={() => {
                      setPicked(rec);
                      pushRecent(rec.id);
                      setQueue((prev) => prev.filter((r) => r.id !== rec.id));
                    }}
                    className="text-left w-full"
                  >
                    <div className="font-medium">{rec.title}</div>
                    <div className="text-sm subtle">{rec.artists.join(", ") || "Unknown artist"}</div>
                    <div className="text-xs subtle mt-1">{rec.genre || "Unknown genre"}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  );
}

export default function RandomPickerPage() {
  return (
    <Suspense fallback={<main className="page-shell py-8 subtle">Loading random picker...</main>}>
      <RandomPickerContent />
    </Suspense>
  );
}
