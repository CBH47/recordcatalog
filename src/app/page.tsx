"use client";
import { CubbyWall } from "../components/CubbyWall";
import { TopPageSelector } from "../components/TopPageSelector";
import type { Record } from "../components/CubbyWall";
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Link from "next/link";

type OrderingStyle = "genre-artist" | "artist-only";
type CubbyStyleMap = { [cubby: number]: OrderingStyle };

export default function Home() {
  const REBUILD_PIN = "4774";

  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record | null>(null);
  const [discogsData, setDiscogsData] = useState<any | null>(null);
  const [discogsLoading, setDiscogsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [cubbyInput, setCubbyInput] = useState("");
  const [cubbySaving, setCubbySaving] = useState(false);
  const [orderingCheckLoading, setOrderingCheckLoading] = useState(false);
  const [orderingMessage, setOrderingMessage] = useState<string | null>(null);
  const [showOrderingConfirm, setShowOrderingConfirm] = useState(false);
  const [orderingPendingCount, setOrderingPendingCount] = useState(0);
  const [styleByCubby, setStyleByCubby] = useState<CubbyStyleMap>({});
  const [styleSyncMessage, setStyleSyncMessage] = useState<string | null>(null);
  const [rebuildGroupSize, setRebuildGroupSize] = useState("20");
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const [rebuildPinInput, setRebuildPinInput] = useState("");

  const cubbyNumbers = useMemo(() => {
    const unique = Array.from(
      new Set(records.map((r) => (typeof r.cubby === "number" ? r.cubby : 0)))
    );
    return unique.sort((a, b) => a - b);
  }, [records]);

  useEffect(() => {
    setStyleByCubby((prev) => {
      const next: CubbyStyleMap = { ...prev };
      let changed = false;

      for (const cubby of cubbyNumbers) {
        if (!next[cubby]) {
          next[cubby] = "genre-artist";
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [cubbyNumbers]);

  const fetchRecords = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("records")
      .select("id,title,discogs_id,genre:genres(name),subgenre:subgenres(name),cubby,order,on_my_wall,out_for_the_day,image_url,artists(name)")
      .order("cubby", { ascending: true })
      .order("order", { ascending: true });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const mapped = (data || []).map((rec: any) => ({
      ...rec,
      genre: rec.genre?.name || "",
      subgenre: rec.subgenre?.name || "",
      artists: rec.artists ? rec.artists.map((a: any) => a.name) : [],
    }));
    setRecords(mapped);
    setLoading(false);
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  useEffect(() => {
    const loadPersistedStyles = async () => {
      try {
        const res = await fetch("/api/cubby-ordering-styles");
        const data = await res.json();
        if (!res.ok) return;

        if (data?.missingTable) {
          setStyleSyncMessage("Style persistence table is missing; using in-session defaults.");
          return;
        }

        if (data?.styleByCubby && typeof data.styleByCubby === "object") {
          setStyleByCubby((prev) => ({
            ...data.styleByCubby,
            ...prev,
          }));
          setStyleSyncMessage("Per-cubby styles loaded from Supabase.");
        }
      } catch {
        setStyleSyncMessage("Unable to load saved cubby styles.");
      }
    };

    loadPersistedStyles();
  }, []);

  const persistStyles = async (nextStyles: CubbyStyleMap) => {
    try {
      const res = await fetch("/api/cubby-ordering-styles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleByCubby: nextStyles }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save cubby styles");
      }
      setStyleSyncMessage("Per-cubby styles saved.");
    } catch (err: any) {
      setStyleSyncMessage(err?.message || "Failed to save cubby styles.");
    }
  };

  const handleEnsureOrdering = async () => {
    setOrderingCheckLoading(true);
    setOrderingMessage(null);

    try {
      const res = await fetch("/api/ensure-ordering", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false, styleByCubby }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to verify ordering");
      }

      if (data.alreadyOrdered) {
        setOrderingMessage("Ordering is already correct for all cubbies.");
      } else {
        setOrderingPendingCount(Number(data.needsUpdate || 0));
        setShowOrderingConfirm(true);
      }
    } catch (err: any) {
      setOrderingMessage(err?.message || "Failed to verify ordering");
    } finally {
      setOrderingCheckLoading(false);
    }
  };

  const handleApplyOrdering = async () => {
    setOrderingCheckLoading(true);
    setOrderingMessage(null);

    try {
      const res = await fetch("/api/ensure-ordering", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true, styleByCubby }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to apply ordering");
      }

      setShowOrderingConfirm(false);
      setOrderingMessage(`Ordering repaired: updated ${data.updated} of ${data.total} records.`);
      await fetchRecords();
    } catch (err: any) {
      setOrderingMessage(err?.message || "Failed to apply ordering");
    } finally {
      setOrderingCheckLoading(false);
    }
  };

  const handleToggleWall = (id: number) => {
    setRecords((prev) =>
      prev.map((rec) =>
        rec.id === id ? { ...rec, on_my_wall: !rec.on_my_wall } : rec
      )
    );
  };

  const handleToggleOut = (id: number) => {
    setRecords((prev) =>
      prev.map((rec) =>
        rec.id === id ? { ...rec, out_for_the_day: !rec.out_for_the_day } : rec
      )
    );
  };

  const handleCubbyChange = async (recordId: number, newCubby: number, newOrder?: number) => {
    // Optimistically update UI
    setRecords((prev) =>
      prev.map((rec) =>
        rec.id === recordId
          ? { ...rec, cubby: newCubby, ...(newOrder !== undefined ? { order: newOrder } : {}) }
          : rec
      )
    );

    // Update server
    try {
      const res = await fetch('/api/updateCubby', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, cubby: newCubby, ...(newOrder !== undefined ? { order: newOrder } : {}) }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to update cubby');
      }
    } catch (err) {
      console.error('Cubby update failed:', err);
      // Revert on error
      setRecords((prev) =>
        prev.map((rec) =>
          rec.id === recordId
            ? prev.find((r) => r.id === recordId) || rec
            : rec
        )
      );
    }
  };

  const handleRecordClick = async (record: Record) => {
    setSelected(record);
    setCubbyInput(record.cubby !== null && record.cubby !== undefined ? String(record.cubby) : "");
    setDiscogsData(null);
    if (record.discogs_id) {
      setDiscogsLoading(true);
      try {
        const res = await fetch(`/api/discogs?id=${record.discogs_id}`);
        const data = await res.json();
        setDiscogsData(data);
      } catch (e) {
        setDiscogsData({ error: 'Failed to fetch Discogs data' });
      }
      setDiscogsLoading(false);
    }
  };

  const handleSaveModalCubby = async () => {
    if (!selected) return;

    const parsed = Number.parseInt(cubbyInput.trim(), 10);
    if (Number.isNaN(parsed)) {
      setOrderingMessage("Enter a valid cubby number.");
      return;
    }

    setCubbySaving(true);
    setOrderingMessage(null);

    try {
      const res = await fetch('/api/updateCubby', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: selected.id, cubby: parsed }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update cubby');
      }

      setRecords((prev) => prev.map((rec) => (rec.id === selected.id ? { ...rec, cubby: parsed } : rec)));
      setSelected((prev) => (prev ? { ...prev, cubby: parsed } : prev));
      setOrderingMessage(`Updated cubby to ${parsed}.`);
    } catch (err: any) {
      setOrderingMessage(err?.message || 'Failed to update cubby');
    } finally {
      setCubbySaving(false);
    }
  };

  const handleRebuildCubbies = async () => {
    const parsed = Number.parseInt(rebuildGroupSize.trim(), 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setOrderingMessage("Enter a valid positive group size.");
      return;
    }

    if (rebuildPinInput.trim() !== REBUILD_PIN) {
      setOrderingMessage("Incorrect PIN. Rebuild cancelled.");
      return;
    }

    setRebuildLoading(true);
    setOrderingMessage(null);

    try {
      const res = await fetch("/api/rebuild-cubbies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupSize: parsed, styleByCubby }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to rebuild cubbies");
      }

      setOrderingMessage(
        `Rebuilt ${data.total} records into ${data.cubbiesCreated} cubbies (size ${data.groupSize}). Updated ${data.changed} record(s).`
      );
      setShowRebuildConfirm(false);
      setRebuildPinInput("");
      await fetchRecords();
    } catch (err: any) {
      setOrderingMessage(err?.message || "Failed to rebuild cubbies");
    } finally {
      setRebuildLoading(false);
    }
  };

  return (
    <main className="flex flex-col flex-1 page-shell fade-in">
      <div className="hero-card px-4 py-5 md:px-6 md:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="h-10 w-[3px] bg-red-500 rounded" />
              <p className="text-xs md:text-sm uppercase tracking-[0.35em] subtle">Your Vinyl Collection</p>
            </div>
            <h1 className="hero-title">
              Record <span className="hero-accent">Catalog</span>
            </h1>
            <p className="text-sm subtle mt-2">Organize your wall by cubby and drag records across separators with precision.</p>
          </div>
          <TopPageSelector currentPage="wall" />
        </div>

        <div className="mt-5 relative max-w-xl">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, artist, or genre..."
            className="field pr-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 subtle hover:text-white"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        {searchQuery && (
          <p className="text-xs subtle mt-2">
            {records.filter((r) => {
              const q = searchQuery.toLowerCase();
              return r.title.toLowerCase().includes(q) || r.artists.some((a) => a.toLowerCase().includes(q)) || r.genre.toLowerCase().includes(q);
            }).length} result(s)
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={handleEnsureOrdering}
            disabled={orderingCheckLoading}
            className="btn btn-secondary"
          >
            {orderingCheckLoading ? "Checking order..." : "Check / Repair Ordering"}
          </button>
          {orderingMessage && <p className="text-xs subtle">{orderingMessage}</p>}
        </div>

        <div className="mt-4 rounded-xl border border-zinc-800/90 bg-zinc-950/65 p-3 md:p-4">
          <p className="text-xs uppercase tracking-[0.2em] subtle">Per-Cubby Ordering Style</p>
          <p className="text-sm subtle mt-1">Choose how each cubby should be sorted when you run Check/Repair or Rebuild.</p>
          {styleSyncMessage && <p className="text-xs subtle mt-2">{styleSyncMessage}</p>}
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {cubbyNumbers.map((cubby) => (
              <div key={cubby}>
                <label className="block text-xs subtle mb-1">{cubby === 0 ? "Unassigned" : `Cubby ${cubby}`}</label>
                <select
                  value={styleByCubby[cubby] || "genre-artist"}
                  onChange={(e) => {
                    const nextStyle: OrderingStyle = e.target.value === "artist-only" ? "artist-only" : "genre-artist";
                    setStyleByCubby((prev) => {
                      const next = {
                        ...prev,
                        [cubby]: nextStyle,
                      };
                      void persistStyles(next);
                      return next;
                    });
                  }}
                  className="field"
                >
                  <option value="genre-artist">Genre then artist</option>
                  <option value="artist-only">Pure artist</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-800/90 bg-zinc-950/65 p-3 md:p-4">
          <p className="text-xs uppercase tracking-[0.2em] subtle">Cubby Rebuild</p>
          <p className="text-sm subtle mt-1">Collapse all cubbies, apply true ordering, and reform cubbies in fixed-size groups.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs subtle mb-1">Records per cubby</label>
              <input
                type="number"
                min={1}
                value={rebuildGroupSize}
                onChange={(e) => setRebuildGroupSize(e.target.value)}
                className="field w-36"
                placeholder="Group size"
                aria-label="Cubby group size"
              />
            </div>
            <button
              onClick={() => {
                const parsed = Number.parseInt(rebuildGroupSize.trim(), 10);
                if (Number.isNaN(parsed) || parsed <= 0) {
                  setOrderingMessage("Enter a valid positive group size.");
                  return;
                }
                setOrderingMessage(null);
                setRebuildPinInput("");
                setShowRebuildConfirm(true);
              }}
              disabled={rebuildLoading}
              className="btn btn-primary"
            >
              {rebuildLoading ? "Rebuilding..." : "Rebuild Cubbies"}
            </button>
            <p className="text-xs subtle">Requires PIN confirmation.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 mt-4 panel">
        {loading ? (
          <div className="subtle text-center py-12">Loading records...</div>
        ) : error ? (
          <div className="text-red-400 text-center py-12">Error: {error}</div>
        ) : (
          <CubbyWall
            records={searchQuery
              ? records.filter((r) => {
                  const q = searchQuery.toLowerCase();
                  return r.title.toLowerCase().includes(q) || r.artists.some((a) => a.toLowerCase().includes(q)) || r.genre.toLowerCase().includes(q);
                })
              : records}
            onToggleWall={handleToggleWall}
            onToggleOut={handleToggleOut}
            onCubbyChange={handleCubbyChange}
            onRecordClick={handleRecordClick}
          />
        )}
      </div>

      {/* Discogs Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 px-4" onClick={() => setSelected(null)}>
          <div className="panel p-6 max-w-lg w-full relative max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <button className="absolute top-2 right-2 subtle hover:text-white" onClick={() => setSelected(null)}>✕</button>
            <h2 className="text-xl font-bold mb-2">{selected.title}</h2>
            <div className="mb-2 subtle">{selected.artists?.join(", ")}</div>
            <div className="mb-2 text-xs subtle">{selected.genre}</div>
            <div className="mb-3 text-sm subtle">
              Cubby: {selected.cubby ?? "Unassigned"}
            </div>
            <div className="mb-4 flex items-end gap-2">
              <div>
                <label className="block text-xs subtle mb-1">Set cubby</label>
                <input
                  value={cubbyInput}
                  onChange={(e) => setCubbyInput(e.target.value)}
                  placeholder="e.g. 4"
                  className="field w-28"
                />
              </div>
              <button
                onClick={handleSaveModalCubby}
                disabled={cubbySaving}
                className="btn btn-secondary"
              >
                {cubbySaving ? "Saving..." : "Save cubby"}
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  void fetch("/api/listening-history", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      recordId: selected.id,
                      title: selected.title,
                      artist: selected.artists?.join(", ") || "",
                    }),
                  });
                  setOrderingMessage(`Logged play for "${selected.title}".`);
                }}
                className="pill-nav"
              >
                Log play
              </button>
              {selected.genre && (
                <Link
                  href={`/genres/${encodeURIComponent(selected.genre)}`}
                  className="pill-nav"
                >
                  Genre page
                </Link>
              )}
              {selected.artists?.[0] && (
                <Link
                  href={`/artists/${encodeURIComponent(selected.artists[0])}`}
                  className="pill-nav"
                >
                  Artist page
                </Link>
              )}
            </div>
            {discogsLoading && <div>Loading Discogs data...</div>}
            {discogsData && discogsData.error && <div className="text-red-400">{discogsData.error}</div>}
            {discogsData && !discogsData.error && (
              <div>
                {discogsData.images && discogsData.images[0] && (
                  <img src={discogsData.images[0].uri} alt="cover" className="mb-3 rounded-lg border border-zinc-800" style={{ maxHeight: 240 }} />
                )}
                <div className="mb-1"><b>Year:</b> {discogsData.year}</div>
                <div className="mb-1"><b>Country:</b> {discogsData.country}</div>
                <div className="mb-1"><b>Genres:</b> {discogsData.genres?.join(', ')}</div>
                <div className="mb-1"><b>Styles:</b> {discogsData.styles?.join(', ')}</div>
                <div className="mb-1"><b>Tracklist:</b>
                  <ul className="list-disc ml-6">
                    {discogsData.tracklist?.map((t: any, i: number) => (
                      <li key={i}>{t.position} {t.title} {t.duration && `(${t.duration})`}</li>
                    ))}
                  </ul>
                </div>
                <a href={discogsData.uri} target="_blank" rel="noopener noreferrer" className="text-red-300 underline">View on Discogs</a>
              </div>
            )}
            {!discogsLoading && !discogsData && <div className="subtle">No Discogs data available.</div>}
          </div>
        </div>
      )}

      {showOrderingConfirm && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 px-4" onClick={() => setShowOrderingConfirm(false)}>
          <div className="panel p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Apply Ordering Fix?</h2>
            <p className="text-sm subtle mt-2">
              Found {orderingPendingCount} record(s) out of order. Do you want to apply canonical ordering using your per-cubby style rules?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowOrderingConfirm(false)}
                className="btn btn-secondary"
                disabled={orderingCheckLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleApplyOrdering}
                className="btn btn-primary"
                disabled={orderingCheckLoading}
              >
                {orderingCheckLoading ? "Applying..." : "Apply fix"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRebuildConfirm && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 px-4" onClick={() => setShowRebuildConfirm(false)}>
          <div className="panel p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Confirm Cubby Rebuild</h2>
            <p className="text-sm subtle mt-2">
              This will collapse existing cubby grouping and reform cubbies in groups of {rebuildGroupSize} records, then apply your per-cubby style rules.
            </p>
            <div className="mt-4">
              <label className="block text-xs subtle mb-1">Enter PIN to confirm</label>
              <input
                type="password"
                inputMode="numeric"
                value={rebuildPinInput}
                onChange={(e) => setRebuildPinInput(e.target.value)}
                placeholder="PIN"
                className="field"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowRebuildConfirm(false)}
                className="btn btn-secondary"
                disabled={rebuildLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleRebuildCubbies}
                className="btn btn-primary"
                disabled={rebuildLoading}
              >
                {rebuildLoading ? "Rebuilding..." : "Confirm rebuild"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
// ...existing code...
