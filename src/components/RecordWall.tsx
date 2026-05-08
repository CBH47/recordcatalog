export const RecordWall: React.FC<RecordWallProps> = ({ records, onToggleWall, onToggleOut }) => {
  const [selected, setSelected] = useState<Record | null>(null);
  const [discogsData, setDiscogsData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClick = async (record: Record) => {
    setSelected(record);
    setDiscogsData(null);
    if (record.discogs_id) {
      setLoading(true);
      try {
        const res = await fetch(`/api/discogs?id=${record.discogs_id}`);
        const data = await res.json();
        setDiscogsData(data);
      } catch (e) {
        setDiscogsData({ error: 'Failed to fetch Discogs data' });
      }
      setLoading(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 w-full">
        {records.map((record) => (
          // Show only non-empty, unique tags (genre + subgenre).
          // This prevents a second chip when subgenre is empty or the same as genre.
          (() => {
            const imageSrc = record.image_url
              ? `/api/cover-proxy?src=${encodeURIComponent(record.image_url)}${record.discogs_id ? `&id=${encodeURIComponent(record.discogs_id)}` : ''}`
              : null;
            const tags = [record.genre, record.subgenre]
              .map((v) => (v || '').trim())
              .filter(Boolean)
              .filter((value, idx, arr) => arr.findIndex((x) => x.toLowerCase() === value.toLowerCase()) === idx);

            return (
          <div
            key={record.id}
            className="bg-zinc-100 dark:bg-zinc-900 rounded-lg shadow p-2 flex flex-col items-center cursor-pointer"
            onClick={() => handleClick(record)}
          >
            {imageSrc ? (
              <img
                src={imageSrc}
                alt={record.title}
                className="w-full h-32 object-cover rounded mb-2"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.dataset.fallbackApplied === '1') return;
                  img.dataset.fallbackApplied = '1';
                  img.src = '/no-cover.svg';
                }}
              />
            ) : (
              <div className="w-full h-32 bg-zinc-300 dark:bg-zinc-700 rounded mb-2 flex items-center justify-center text-xs text-zinc-500">
                No Image
              </div>
            )}
            <div className="font-semibold text-sm text-center line-clamp-2 mb-1">{record.title}</div>
            <div className="text-xs text-zinc-500 mb-1 text-center line-clamp-2">
              {record.artists.join(", ")}
            </div>
            {tags.length > 0 && (
              <div className="flex gap-1 mb-2 flex-wrap justify-center">
                {tags.map((tag) => (
                  <span key={tag.toLowerCase()} className="text-xs bg-zinc-200 dark:bg-zinc-800 rounded px-2 py-0.5">{tag}</span>
                ))}
              </div>
            )}
            <div className="flex gap-2 w-full justify-between">
              <button
                className={`text-xs px-2 py-1 rounded ${record.on_my_wall ? "bg-green-500 text-white" : "bg-zinc-300 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200"}`}
                onClick={e => { e.stopPropagation(); onToggleWall(record.id); }}
              >
                Wall
              </button>
              <button
                className={`text-xs px-2 py-1 rounded ${record.out_for_the_day ? "bg-blue-500 text-white" : "bg-zinc-300 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200"}`}
                onClick={e => { e.stopPropagation(); onToggleOut(record.id); }}
              >
                Out
              </button>
            </div>
            <div className="text-xs text-zinc-400 mt-1">Cubby: {record.cubby}</div>
          </div>
            );
          })()
        ))}
      </div>
      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" onClick={() => setSelected(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 max-w-lg w-full relative" onClick={e => e.stopPropagation()}>
            <button className="absolute top-2 right-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white" onClick={() => setSelected(null)}>✕</button>
            <h2 className="text-xl font-bold mb-2">{selected.title}</h2>
            <div className="mb-2 text-zinc-500">{selected.artists?.join(", ")}</div>
            <div className="mb-2 text-xs text-zinc-400">{selected.genre}</div>
            {loading && <div>Loading Discogs data...</div>}
            {discogsData && discogsData.error && <div className="text-red-500">{discogsData.error}</div>}
            {discogsData && !discogsData.error && (
              <div>
                {discogsData.images && discogsData.images[0] && (
                  <img src={discogsData.images[0].uri} alt="cover" className="mb-2 rounded shadow" style={{ maxHeight: 200 }} />
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
                <a href={discogsData.uri} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">View on Discogs</a>
              </div>
            )}
            {!loading && !discogsData && <div className="text-zinc-400">No Discogs data available.</div>}
          </div>
        </div>
      )}
    </>
  );
};
import React, { useState } from "react";

export interface Record {
  id: number;
  title: string;
  artists: string[];
  genre: string;
  subgenre: string;
  cubby: number;
  on_my_wall: boolean;
  out_for_the_day: boolean;
  image_url?: string;
  discogs_id?: string | null;
}

interface RecordWallProps {
  records: Record[];
  onToggleWall: (id: number) => void;
  onToggleOut: (id: number) => void;
}

