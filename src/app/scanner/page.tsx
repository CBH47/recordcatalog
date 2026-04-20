"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { TopPageSelector } from "../../components/TopPageSelector";

type BarcodePreview = {
  discogsId: number;
  upc: string;
  title: string;
  artists: string[];
  year: number | null;
  country: string | null;
  genres: string[];
  styles: string[];
  image_url: string | null;
  uri: string | null;
};

type BatchItem = {
  preview: BarcodePreview;
  cubby: number | null;
};

type BarcodeDetectorLike = {
  detect: (input: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts?: { formats?: string[] }): BarcodeDetectorLike;
    };
  }
}

export default function ScannerPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  const [supportsBarcodeDetector, setSupportsBarcodeDetector] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [upc, setUpc] = useState("");
  const [cubby, setCubby] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BarcodePreview | null>(null);
  const [addedMessage, setAddedMessage] = useState<string | null>(null);
  const [batchQueue, setBatchQueue] = useState<BatchItem[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);

  useEffect(() => {
    setSupportsBarcodeDetector(typeof window !== "undefined" && Boolean(window.BarcodeDetector));
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopScanner = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsScanning(false);
  };

  const startScanner = async () => {
    setError(null);
    setAddedMessage(null);

    if (!window.BarcodeDetector) {
      setError("This browser does not support BarcodeDetector. Enter UPC manually below.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const detector = new window.BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
      });

      timerRef.current = window.setInterval(async () => {
        if (!videoRef.current) return;

        try {
          const barcodes = await detector.detect(videoRef.current);
          const first = barcodes.find((b) => b.rawValue && /\d{8,14}/.test(b.rawValue));
          if (first?.rawValue) {
            const digits = first.rawValue.replace(/[^0-9]/g, "");
            if (digits) {
              setUpc(digits);
              stopScanner();
            }
          }
        } catch {
          // Ignore intermittent decode errors while scanning.
        }
      }, 450);

      setIsScanning(true);
    } catch (err: any) {
      setError(err?.message || "Unable to access camera for barcode scanning.");
      stopScanner();
    }
  };

  const handleLookup = async () => {
    setError(null);
    setAddedMessage(null);
    setPreview(null);

    const cleanUpc = upc.replace(/[^0-9]/g, "");
    if (!cleanUpc) {
      setError("Enter a valid UPC first.");
      return;
    }

    setLookupLoading(true);
    try {
      const res = await fetch(`/api/discogs-barcode?upc=${encodeURIComponent(cleanUpc)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Barcode lookup failed");
      }
      setPreview(data.preview);
    } catch (err: any) {
      setError(err?.message || "Barcode lookup failed");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleAddRecord = async () => {
    if (!preview) return;

    setError(null);
    setAddedMessage(null);
    setAddLoading(true);

    try {
      const parsedCubby = cubby.trim() === "" ? null : Number.parseInt(cubby, 10);
      const res = await fetch("/api/add-record-from-discogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discogsId: preview.discogsId,
          cubby: Number.isNaN(parsedCubby as number) ? null : parsedCubby,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to add record");
      }

      setAddedMessage(`Added "${data.title}" to collection${data.cubby === null ? '' : ` in cubby ${data.cubby}`}.`);
    } catch (err: any) {
      setError(err?.message || "Failed to add record");
    } finally {
      setAddLoading(false);
    }
  };

  const handleAddToBatch = () => {
    if (!preview) return;

    const parsedCubby = cubby.trim() === "" ? null : Number.parseInt(cubby, 10);
    const normalizedCubby = Number.isNaN(parsedCubby as number) ? null : parsedCubby;

    setBatchQueue((prev) => {
      if (prev.some((item) => item.preview.discogsId === preview.discogsId)) {
        setBatchMessage(`"${preview.title}" is already in the batch queue.`);
        return prev;
      }

      setBatchMessage(`Queued "${preview.title}" for batch add.`);
      return [...prev, { preview, cubby: normalizedCubby }];
    });
  };

  const handleRemoveFromBatch = (discogsId: number) => {
    setBatchQueue((prev) => prev.filter((item) => item.preview.discogsId !== discogsId));
  };

  const handleCommitBatch = async () => {
    if (!batchQueue.length) return;

    setBatchLoading(true);
    setError(null);
    setBatchMessage(null);

    let success = 0;
    const failures: string[] = [];

    for (const item of batchQueue) {
      try {
        const res = await fetch("/api/add-record-from-discogs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            discogsId: item.preview.discogsId,
            cubby: item.cubby,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Batch add failed");
        }

        success += 1;
      } catch (err: any) {
        failures.push(`${item.preview.title}: ${err?.message || "Failed"}`);
      }
    }

    if (failures.length) {
      setBatchMessage(`Batch finished with ${success} success, ${failures.length} failed. ${failures[0]}`);
    } else {
      setBatchMessage(`Batch added ${success} record(s) successfully.`);
      setBatchQueue([]);
    }

    setBatchLoading(false);
  };

  return (
    <main className="flex flex-col flex-1 page-shell fade-in">
      <div className="hero-card px-4 py-5 md:px-6 md:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="h-10 w-[3px] bg-red-500 rounded" />
            <p className="text-xs md:text-sm uppercase tracking-[0.35em] subtle">Acquisition Pipeline</p>
          </div>
          <h1 className="hero-title">
            Barcode <span className="hero-accent">Scanner</span>
          </h1>
          <p className="text-sm subtle mt-2">
            Scan or enter a UPC, preview Discogs match, then add it to your collection with automatic global ordering.
          </p>
        </div>
        <TopPageSelector currentPage="scanner" />
      </div>
      </div>

      <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="panel p-4">
          <h2 className="text-lg font-semibold">Scan UPC</h2>
          <p className="text-xs subtle mt-1">
            {supportsBarcodeDetector
              ? "Camera scanning is supported in this browser."
              : "Camera scanning not supported here. Use manual UPC entry."}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={startScanner}
              disabled={isScanning || !supportsBarcodeDetector}
              className="btn btn-primary"
            >
              Start scanner
            </button>
            <button
              onClick={stopScanner}
              disabled={!isScanning}
              className="btn btn-secondary"
            >
              Stop scanner
            </button>
          </div>

          <div className="mt-3 rounded-md overflow-hidden border border-zinc-800 bg-black">
            <video ref={videoRef} className="w-full max-h-72 object-contain" muted playsInline />
          </div>

          <div className="mt-4">
            <label className="block text-xs subtle mb-1">UPC</label>
            <div className="flex gap-2">
              <input
                value={upc}
                onChange={(e) => setUpc(e.target.value)}
                placeholder="Scan or enter UPC"
                className="field"
              />
              <button
                onClick={handleLookup}
                disabled={lookupLoading}
                className="btn btn-secondary"
              >
                {lookupLoading ? "Looking up..." : "Lookup"}
              </button>
            </div>
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="text-lg font-semibold">Add to Collection</h2>
          <label className="block text-xs subtle mt-3 mb-1">Target cubby (optional)</label>
          <input
            value={cubby}
            onChange={(e) => setCubby(e.target.value)}
            placeholder="e.g. 3"
            className="field"
          />
          <button
            onClick={handleAddRecord}
            disabled={!preview || addLoading}
            className="mt-3 w-full btn btn-primary"
          >
            {addLoading ? "Adding..." : "Add record from preview"}
          </button>
          <button
            onClick={handleAddToBatch}
            disabled={!preview}
            className="mt-2 w-full btn btn-secondary"
          >
            Add preview to batch queue
          </button>
          <p className="text-xs subtle mt-2">
            Ordering is auto-computed globally by genre, artist key, then album title.
          </p>
        </div>
      </section>

      {error && <div className="mt-4 text-sm text-red-400">{error}</div>}
      {addedMessage && <div className="mt-4 text-sm text-green-300">{addedMessage}</div>}
      {batchMessage && <div className="mt-2 text-sm subtle">{batchMessage}</div>}

      {preview && (
        <section className="mt-6 panel p-4">
          <h2 className="text-lg font-semibold">Preview</h2>
          <div className="mt-3 flex flex-col md:flex-row gap-4">
            {preview.image_url ? (
              <img src={preview.image_url} alt={preview.title} className="w-36 h-36 object-cover rounded-md border border-zinc-700" />
            ) : (
              <div className="w-36 h-36 rounded-md border border-zinc-700 bg-zinc-900 flex items-center justify-center text-xs subtle">
                No cover art
              </div>
            )}
            <div>
              <div className="font-semibold text-lg">{preview.title}</div>
              <div className="text-sm mt-1">{preview.artists.join(', ') || 'Unknown artist'}</div>
              <div className="text-sm subtle mt-1">Genres: {preview.genres.join(', ') || 'Unknown'}</div>
              <div className="text-sm subtle">Styles: {preview.styles.join(', ') || 'Unknown'}</div>
              <div className="text-sm subtle">Year: {preview.year || 'Unknown'} | Country: {preview.country || 'Unknown'}</div>
              <div className="text-sm subtle">Discogs ID: {preview.discogsId} | UPC: {preview.upc}</div>
              {preview.uri && (
                <a href={preview.uri} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-sm underline text-red-300">
                  View on Discogs
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="mt-6 panel p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Batch Review Queue</h2>
            <p className="text-xs subtle mt-1">Queue multiple scans and commit in one action.</p>
          </div>
          <button
            onClick={handleCommitBatch}
            disabled={!batchQueue.length || batchLoading}
            className="btn btn-primary"
          >
            {batchLoading ? "Committing..." : `Commit batch (${batchQueue.length})`}
          </button>
        </div>

        {batchQueue.length === 0 ? (
          <p className="text-sm subtle mt-3">No records in queue yet. Lookup a record and click Add preview to batch queue.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {batchQueue.map((item) => (
              <li key={item.preview.discogsId} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{item.preview.title}</p>
                  <p className="text-sm subtle">{item.preview.artists.join(", ") || "Unknown artist"}</p>
                  <p className="text-xs subtle mt-1">
                    Cubby: {item.cubby === null ? "Unassigned" : item.cubby} | Discogs ID: {item.preview.discogsId}
                  </p>
                </div>
                <button className="btn btn-secondary" onClick={() => handleRemoveFromBatch(item.preview.discogsId)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
