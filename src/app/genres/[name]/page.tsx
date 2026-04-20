"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type GenreRecord = {
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

export default function GenrePage() {
  const params = useParams<{ name: string }>();
  const genreName = decodeURIComponent(params.name || "");

  const [records, setRecords] = useState<GenreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<GenreRecord | null>(null);

  useEffect(() => {
    const fetchGenreRecords = async () => {
      setLoading(true);
      setError(null);

      const { data: genreRow, error: genreErr } = await supabase
        .from("genres")
        .select("id")
        .eq("name", genreName)
        .maybeSingle();

      if (genreErr) {
        setError(genreErr.message);
        setLoading(false);
        return;
      }

      if (!genreRow?.id) {
        setRecords([]);
        setLoading(false);
        return;
      }

      const { data, error: recordsErr } = await supabase
        .from("records")
        .select("id,title,cubby,image_url,genre:genres(name),subgenre:subgenres(name),artists(name)")
        .eq("genre_id", genreRow.id)
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

    fetchGenreRecords();
  }, [genreName]);

  const artistCount = useMemo(() => new Set(records.flatMap((r) => r.artists)).size, [records]);

  return (
    <main className="flex flex-col flex-1 w-full mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Genre: {genreName}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {records.length} record(s) by {artistCount} artist(s)
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
          Random from this genre
        </button>
      </div>

      {picked && (
        <div className="mt-4 rounded-md border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
          <div className="font-semibold">{picked.title}</div>
          <div className="text-sm text-zinc-500">{picked.artists.join(", ") || "Unknown artist"}</div>
          <div className="text-sm text-zinc-500">Cubby: {picked.cubby === null ? "Unassigned" : picked.cubby}</div>
        </div>
      )}

      <section className="mt-6">
        {loading ? (
          <div className="text-zinc-500">Loading records...</div>
        ) : error ? (
          <div className="text-red-500">Error: {error}</div>
        ) : records.length === 0 ? (
          <div className="text-zinc-500">No records found for this genre.</div>
        ) : (
          <ul className="space-y-2">
            {records.map((rec) => (
              <li key={rec.id} className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-900">
                <div className="font-medium">{rec.title}</div>
                <div className="text-sm text-zinc-500">{rec.artists.join(", ") || "Unknown artist"}</div>
                <div className="text-sm text-zinc-500">{rec.subgenre ? `Subgenre: ${rec.subgenre}` : "No subgenre"}</div>
                <div className="text-sm text-zinc-500">Cubby: {rec.cubby === null ? "Unassigned" : rec.cubby}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
