"use client";
import { CubbyWall } from "../components/CubbyWall";
import { TopPageSelector } from "../components/TopPageSelector";
import type { Record } from "../components/CubbyWall";
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Link from "next/link";

export default function Home() {
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record | null>(null);
  const [discogsData, setDiscogsData] = useState<any | null>(null);
  const [discogsLoading, setDiscogsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
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
      // Map artists and flatten genre/subgenre
      const mapped = (data || []).map((rec: any) => ({
        ...rec,
        genre: rec.genre?.name || "",
        subgenre: rec.subgenre?.name || "",
        artists: rec.artists ? rec.artists.map((a: any) => a.name) : [],
      }));
      setRecords(mapped);
      setLoading(false);
    };
    fetchRecords();
  }, []);

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
            <div className="mb-3 flex flex-wrap gap-2">
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
    </main>
  );
}
// ...existing code...
