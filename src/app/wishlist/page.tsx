"use client";

import React, { useCallback, useEffect, useState } from "react";
import { TopPageSelector } from "../../components/TopPageSelector";
import { type WishlistItem } from "../../lib/collectionExtras";

type TrendLookupResponse = {
  discogsId: number;
  checkedAt: string;
  currency: string | null;
  lowestPrice: number | null;
  medianPrice: number | null;
  numForSale: number | null;
};

type Point = {
  x: number;
  y: number;
};

type ChartWindow = "7" | "30" | "all";

function parseTargetPrice(value: string): number | null {
  if (!value.trim()) return null;
  const cleaned = value.replace(/[^0-9.]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPrice(value: number | null, currency: string | null): string {
  if (value === null) return "N/A";
  const code = currency || "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

function trendLabel(value: WishlistItem["lastTrend"]) {
  if (value === "up") return "Trend: up";
  if (value === "down") return "Trend: down";
  if (value === "flat") return "Trend: flat";
  return "Trend: unknown";
}

function buildPoints(values: number[], width = 220, height = 60): Point[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(0.00001, max - min);
  const xStep = values.length > 1 ? width / (values.length - 1) : width;

  return values.map((value, index) => ({
    x: index * xStep,
    y: height - ((value - min) / spread) * height,
  }));
}

function pointsToPolyline(points: Point[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function filterSnapshotsByWindow(
  snapshots: NonNullable<WishlistItem["priceSnapshots"]>,
  chartWindow: ChartWindow
) {
  if (chartWindow === "all") return snapshots;

  const days = Number.parseInt(chartWindow, 10);
  if (!Number.isFinite(days)) return snapshots;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return snapshots.filter((snapshot) => {
    const checked = new Date(snapshot.checkedAt);
    return !Number.isNaN(checked.getTime()) && checked >= cutoff;
  });
}

function PriceSparkline({
  snapshots,
  chartWindow,
}: {
  snapshots: NonNullable<WishlistItem["priceSnapshots"]>;
  chartWindow: ChartWindow;
}) {
  const filtered = filterSnapshotsByWindow(snapshots, chartWindow);
  const lowSeries = filtered.map((snapshot) => snapshot.lowestPrice).filter((value): value is number => value !== null);
  const medianSeries = filtered.map((snapshot) => snapshot.medianPrice).filter((value): value is number => value !== null);

  if (lowSeries.length < 2 && medianSeries.length < 2) {
    return <p className="text-xs subtle mt-2">Need at least 2 checks in this window to draw trend charts.</p>;
  }

  const lowPoints = buildPoints(lowSeries);
  const medianPoints = buildPoints(medianSeries);

  return (
    <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest subtle mb-2">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-400" />Low</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-300" />Median</span>
      </div>
      <svg viewBox="0 0 220 60" className="w-full h-[72px]" role="img" aria-label="Price trend sparkline chart">
        <line x1="0" y1="59.5" x2="220" y2="59.5" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        {lowPoints.length >= 2 && (
          <polyline
            fill="none"
            stroke="rgb(248 113 113)"
            strokeWidth="2"
            points={pointsToPolyline(lowPoints)}
          />
        )}
        {medianPoints.length >= 2 && (
          <polyline
            fill="none"
            stroke="rgb(252 211 77)"
            strokeWidth="2"
            points={pointsToPolyline(medianPoints)}
          />
        )}
      </svg>
    </div>
  );
}

export default function WishlistPage() {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [discogsId, setDiscogsId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [trendLoadingById, setTrendLoadingById] = useState<Record<string, boolean>>({});
  const [trendMessage, setTrendMessage] = useState<string | null>(null);
  const [chartWindow, setChartWindow] = useState<ChartWindow>("30");

  const loadItems = useCallback(async () => {
    const res = await fetch("/api/wishlist");
    if (res.ok) setItems(await res.json());
  }, []);

  useEffect(() => {
    loadItems();
    const sync = () => loadItems();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [loadItems]);

  const handleAdd = async () => {
    setError(null);

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    const res = await fetch("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        artist: artist.trim(),
        targetPrice: targetPrice.trim(),
        notes: notes.trim(),
        status: "wanted",
        discogsId: Number.isFinite(Number.parseInt(discogsId, 10)) ? Number.parseInt(discogsId, 10) : null,
      }),
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError((d as any)?.error || "Failed to add item.");
      return;
    }

    const created: WishlistItem = await res.json();
    setItems((prev) => [created, ...prev]);
    setTitle("");
    setArtist("");
    setTargetPrice("");
    setNotes("");
    setDiscogsId("");
  };

  const checkPriceTrend = async (item: WishlistItem) => {
    setTrendMessage(null);
    setTrendLoadingById((prev) => ({ ...prev, [item.id]: true }));

    try {
      const params = new URLSearchParams();
      params.set("title", item.title);
      if (item.artist) params.set("artist", item.artist);
      if (item.discogsId) params.set("discogsId", String(item.discogsId));

      const res = await fetch(`/api/discogs-price-trend?${params.toString()}`);
      const data = (await res.json()) as TrendLookupResponse | { error?: string };

      if (!res.ok) {
        throw new Error("error" in data ? data.error || "Trend lookup failed" : "Trend lookup failed");
      }

      const trendData = data as TrendLookupResponse;
      const patchRes = await fetch(`/api/wishlist/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "snapshot",
          snapshot: {
            checkedAt: trendData.checkedAt,
            discogsId: trendData.discogsId,
            lowestPrice: trendData.lowestPrice,
            medianPrice: trendData.medianPrice,
            currency: trendData.currency,
            numForSale: trendData.numForSale,
          },
        }),
      });

      if (patchRes.ok) {
        const updated: WishlistItem = await patchRes.json();
        setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
      }
      setTrendMessage(`Updated trend for \"${item.title}\".`);
    } catch (err: any) {
      setTrendMessage(err?.message || "Failed to check trend.");
    } finally {
      setTrendLoadingById((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const refreshAllTrends = async () => {
    const wanted = items.filter((item) => item.status === "wanted");
    for (const item of wanted) {
      // sequential calls avoid tripping Discogs request limits
      // eslint-disable-next-line no-await-in-loop
      await checkPriceTrend(item);
    }
  };

  return (
    <main className="flex flex-col flex-1 page-shell fade-in">
      <div className="hero-card px-4 py-5 md:px-6 md:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="h-10 w-[3px] bg-red-500 rounded" />
              <p className="text-xs md:text-sm uppercase tracking-[0.35em] subtle">Hunt Mode</p>
            </div>
            <h1 className="hero-title">
              Record <span className="hero-accent">Wishlist</span>
            </h1>
            <p className="text-sm subtle mt-2">Track records you want and mark them acquired once found.</p>
          </div>
          <TopPageSelector currentPage="wishlist" />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1.2fr_1fr_160px_160px]">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Album title" className="field" />
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" className="field" />
          <input value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} placeholder="Target $" className="field" />
          <input value={discogsId} onChange={(e) => setDiscogsId(e.target.value)} placeholder="Discogs ID (optional)" className="field" />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (pressing, shop, etc.)" className="field" />
          <button onClick={handleAdd} className="btn btn-primary">Add wishlist item</button>
        </div>
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={refreshAllTrends} className="btn btn-secondary" disabled={items.length === 0}>
              Refresh trends for wanted items
            </button>
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 text-xs">
              {[
                { label: "7d", value: "7" as ChartWindow },
                { label: "30d", value: "30" as ChartWindow },
                { label: "All", value: "all" as ChartWindow },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setChartWindow(option.value)}
                  className={`px-2 py-1 rounded ${chartWindow === option.value ? "bg-red-600 text-white" : "text-zinc-300"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        {trendMessage && <p className="text-xs subtle mt-2">{trendMessage}</p>}
      </div>

      <section className="mt-4 panel p-4">
        {items.length === 0 ? (
          <p className="subtle">No wishlist items yet.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-semibold">{item.title}</p>
                    <p className="text-sm subtle">{item.artist || "Unknown artist"}</p>
                    <p className="text-xs subtle mt-1">
                      {item.targetPrice ? `Target: ${item.targetPrice}` : "No target price"}
                      {item.notes ? ` | ${item.notes}` : ""}
                    </p>
                    {(() => {
                      const snapshots = item.priceSnapshots || [];
                      const latest = snapshots[snapshots.length - 1];
                      if (!latest) return <p className="text-xs subtle mt-1">No trend data yet.</p>;

                      const target = parseTargetPrice(item.targetPrice);
                      const deltaToTarget = target !== null && latest.lowestPrice !== null ? latest.lowestPrice - target : null;

                      return (
                        <p className="text-xs subtle mt-1">
                          {`${trendLabel(item.lastTrend)} | Low: ${formatPrice(latest.lowestPrice, latest.currency)} | Median: ${formatPrice(latest.medianPrice, latest.currency)} | For sale: ${latest.numForSale ?? "N/A"}`}
                          {deltaToTarget !== null
                            ? deltaToTarget <= 0
                              ? ` | At/under target by ${formatPrice(Math.abs(deltaToTarget), latest.currency)}`
                              : ` | Over target by ${formatPrice(deltaToTarget, latest.currency)}`
                            : ""}
                        </p>
                      );
                    })()}
                    {(item.priceSnapshots || []).length > 0 && (
                      <PriceSparkline snapshots={item.priceSnapshots || []} chartWindow={chartWindow} />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn btn-secondary"
                      onClick={() => checkPriceTrend(item)}
                      disabled={Boolean(trendLoadingById[item.id])}
                    >
                      {trendLoadingById[item.id] ? "Checking..." : "Check trend"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={async () => {
                        const newStatus = item.status === "wanted" ? "acquired" : "wanted";
                        const r = await fetch(`/api/wishlist/${item.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ type: "status", status: newStatus }),
                        });
                        if (r.ok) {
                          const updated: WishlistItem = await r.json();
                          setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
                        }
                      }}
                    >
                      {item.status === "wanted" ? "Mark acquired" : "Mark wanted"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={async () => {
                        await fetch(`/api/wishlist/${item.id}`, { method: "DELETE" });
                        setItems((prev) => prev.filter((i) => i.id !== item.id));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
