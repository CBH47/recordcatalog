"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type ArtistRecord = {
  id: number;
  title: string;
  genre: string;
  subgenre: string;
  cubby: number | null;
  image_url?: string;
  artists: string[];
};

function pickRandom<T>(items: T[]): T | null {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

export default function ArtistPage() {
  const params = useParams<{ name: string }>();
  const artistName = decodeURIComponent(params?.name || "");

  const [records, setRecords] = useState<ArtistRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ArtistRecord | null>(null);

  useEffect(() => {
    const fetchArtistRecords = async () => {
      setLoading(true);
      setError(null);

      const { data: artistRow, error: artistErr } = await supabase
        .from("artists")
        .select("id")
        .eq("name", artistName)
        .maybeSingle();

      if (artistErr) {
        setError(artistErr.message);
        setLoading(false);
        return;
      }

      if (!artistRow?.id) {
        setRecords([]);
        setLoading(false);
        return;
      }

      const { data: links, error: linksErr } = await supabase
        .from("record_artists")
        .select("record_id")
        .eq("artist_id", artistRow.id);

      if (linksErr) {
        setError(linksErr.message);
        setLoading(false);
        return;
      }

      const recordIds = (links || []).map((l) => l.record_id).filter(Boolean);
      if (!recordIds.length) {
        setRecords([]);
        setLoading(false);
        return;
      }

      const { data, error: recordsErr } = await supabase
        .from("records")
        .select("id,title,cubby,image_url,genre:genres(name),subgenre:subgenres(name),artists(name)")
        .in("id", recordIds)
        .order("title", { ascending: true });

      if (recordsErr) {
        setError(recordsErr.message);
        setLoading(false);
        return;
      }

      const mapped = (data || []).map((rec: any) => ({
        id: rec.id,
        title: rec.title || "",
        genre: rec.genre?.name || "",
        subgenre: rec.subgenre?.name || "",
        cubby: rec.cubby ?? null,
        image_url: rec.image_url || "",
        artists: rec.artists ? rec.artists.map((a: any) => a.name) : [],
      }));

      setRecords(mapped);
      setLoading(false);
    };

    fetchArtistRecords();
  }, [artistName]);

  const genreCount = useMemo(() => new Set(records.map((r) => r.genre).filter(Boolean)).size, [records]);

  return (
    <main className="flex flex-col flex-1 w-full mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Artist: {artistName}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {records.length} record(s) across {genreCount} genre(s)
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/random" className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Random picker
          </Link>
          <Link href="/" className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Back to wall
          </Link>
        </div>
      </div>

      <div className="mt-4">
        <button
          onClick={() => setPicked(pickRandom(records))}
          disabled={loading || records.length === 0}
          className="rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm disabled:opacity-50"
        >
          Random from this artist
        </button>
      </div>

      {picked && (
        <div className="mt-4 rounded-md border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
          <div className="font-semibold">{picked.title}</div>
          <div className="text-sm text-zinc-500">{picked.genre || "Unknown genre"}{picked.subgenre ? ` / ${picked.subgenre}` : ""}</div>
          <div className="text-sm text-zinc-500">Cubby: {picked.cubby === null ? "Unassigned" : picked.cubby}</div>
        </div>
      )}

      <section className="mt-6">
        {loading ? (
          <div className="text-zinc-500">Loading records...</div>
        ) : error ? (
          <div className="text-red-500">Error: {error}</div>
        ) : records.length === 0 ? (
          <div className="text-zinc-500">No records found for this artist.</div>
        ) : (
          <ul className="space-y-2">
            {records.map((rec) => (
              <li key={rec.id} className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-900">
                <div className="font-medium">{rec.title}</div>
                <div className="text-sm text-zinc-500">{rec.genre || "Unknown genre"}{rec.subgenre ? ` / ${rec.subgenre}` : ""}</div>
                <div className="text-sm text-zinc-500">Cubby: {rec.cubby === null ? "Unassigned" : rec.cubby}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
