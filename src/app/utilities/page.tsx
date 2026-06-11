"use client";

import { useEffect, useState } from "react";
import { TopPageSelector } from "../../components/TopPageSelector";
import { supabase } from "../../lib/supabaseClient";

type OrderingStyle = "genre-artist" | "artist-only";
type CubbyStyleMap = { [cubby: number]: OrderingStyle };

export default function Utilities() {
  const PASSCODE = "4774";
  const REBUILD_PIN = "4774";

  const [passcodeInput, setPasscodeInput] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cubbyNumbers, setCubbyNumbers] = useState<number[]>([]);
  const [styleByCubby, setStyleByCubby] = useState<CubbyStyleMap>({});
  const [selectedStyleCubby, setSelectedStyleCubby] = useState("0");
  const [styleSyncMessage, setStyleSyncMessage] = useState<string | null>(null);
  const [orderingCheckLoading, setOrderingCheckLoading] = useState(false);
  const [orderingMessage, setOrderingMessage] = useState<string | null>(null);
  const [showOrderingConfirm, setShowOrderingConfirm] = useState(false);
  const [orderingPendingCount, setOrderingPendingCount] = useState(0);
  const [rebuildGroupSize, setRebuildGroupSize] = useState("20");
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const [rebuildPinInput, setRebuildPinInput] = useState("");
  const [restoreGenresLoading, setRestoreGenresLoading] = useState(false);

  const handleUnlock = () => {
    if (passcodeInput === PASSCODE) {
      setIsUnlocked(true);
      setError(null);
      return;
    }

    setError("Incorrect passcode.");
  };

  const fetchCubbyNumbers = async () => {
    const { data, error: fetchError } = await supabase
      .from("records")
      .select("cubby");

    if (fetchError) {
      setOrderingMessage(fetchError.message);
      return;
    }

    const unique = Array.from(
      new Set((data || []).map((r: any) => (typeof r.cubby === "number" ? r.cubby : 0)))
    ).sort((a, b) => a - b);

    setCubbyNumbers(unique);
  };

  useEffect(() => {
    if (!isUnlocked) return;
    void fetchCubbyNumbers();
  }, [isUnlocked]);

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

  useEffect(() => {
    if (!cubbyNumbers.length) return;

    const current = Number.parseInt(selectedStyleCubby, 10);
    if (!Number.isFinite(current) || !cubbyNumbers.includes(current)) {
      setSelectedStyleCubby(String(cubbyNumbers[0]));
    }
  }, [cubbyNumbers, selectedStyleCubby]);

  useEffect(() => {
    if (!isUnlocked) return;

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

    void loadPersistedStyles();
  }, [isUnlocked]);

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
      await fetchCubbyNumbers();
    } catch (err: any) {
      setOrderingMessage(err?.message || "Failed to apply ordering");
    } finally {
      setOrderingCheckLoading(false);
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
      await fetchCubbyNumbers();
    } catch (err: any) {
      setOrderingMessage(err?.message || "Failed to rebuild cubbies");
    } finally {
      setRebuildLoading(false);
    }
  };

  const handleRestoreDiscogsGenres = async () => {
    setRestoreGenresLoading(true);
    setOrderingMessage(null);

    try {
      const res = await fetch("/api/restore-discogs-genres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to restore Discogs genres");
      }

      setOrderingMessage(
        `Discogs genre restore complete. Updated ${data.updated}, unchanged ${data.unchanged}, skipped ${data.skipped}, total ${data.total}.`
      );
    } catch (err: any) {
      setOrderingMessage(err?.message || "Failed to restore Discogs genres");
    } finally {
      setRestoreGenresLoading(false);
    }
  };

  if (!isUnlocked) {
    return (
      <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-black via-red-950 to-black px-4 py-8">
        <div className="w-full max-w-md rounded-2xl border border-red-900/60 bg-black/40 p-6 shadow-2xl shadow-black/40">
          <h1 className="mb-2 text-2xl font-bold text-white">Utilities Locked</h1>
          <p className="mb-5 text-sm text-zinc-300">Enter the passcode to access the utilities panel.</p>

          <label htmlFor="utilities-passcode" className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-zinc-300">
            Passcode
          </label>
          <input
            id="utilities-passcode"
            type="password"
            value={passcodeInput}
            onChange={(e) => {
              setPasscodeInput(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleUnlock();
            }}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white outline-none transition focus:border-red-500"
            placeholder="Enter passcode"
          />

          {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

          <button
            type="button"
            onClick={handleUnlock}
            className="mt-5 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500"
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-gradient-to-br from-black via-red-950 to-black">
      <div className="px-4 pt-4">
        <TopPageSelector currentPage="utilities" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-8">Utilities</h1>

          <div className="space-y-6">
            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/65 p-4">
              <p className="text-xs uppercase tracking-[0.2em] subtle">Discogs Genre Restore</p>
              <p className="text-sm subtle mt-1">Replace each record's current genre with the Discogs genre already stored in your database.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleRestoreDiscogsGenres}
                  disabled={restoreGenresLoading}
                  className="btn btn-secondary"
                >
                  {restoreGenresLoading ? "Restoring genres..." : "Restore Genres from Discogs"}
                </button>
                <p className="text-xs subtle">No external Discogs calls are made.</p>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/65 p-4">
              <p className="text-xs uppercase tracking-[0.2em] subtle">Ordering Repair</p>
              <p className="text-sm subtle mt-1">Check and repair canonical ordering across cubbies.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleEnsureOrdering}
                  disabled={orderingCheckLoading}
                  className="btn btn-secondary"
                >
                  {orderingCheckLoading ? "Checking order..." : "Check / Repair Ordering"}
                </button>
                <button
                  onClick={() => void fetchCubbyNumbers()}
                  className="btn btn-secondary"
                >
                  Refresh Cubbies
                </button>
              </div>
              {orderingMessage && <p className="text-xs subtle mt-3">{orderingMessage}</p>}
            </div>

            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/65 p-4">
              <p className="text-xs uppercase tracking-[0.2em] subtle">Per-Cubby Ordering Style</p>
              <p className="text-sm subtle mt-1">Choose how each cubby should be sorted when running repair or rebuild.</p>
              {styleSyncMessage && <p className="text-xs subtle mt-2">{styleSyncMessage}</p>}
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs subtle mb-1">Cubby</label>
                  <select
                    value={selectedStyleCubby}
                    onChange={(e) => setSelectedStyleCubby(e.target.value)}
                    className="field min-w-40"
                    disabled={!cubbyNumbers.length}
                  >
                    {cubbyNumbers.map((cubby) => (
                      <option key={cubby} value={String(cubby)}>
                        {cubby === 0 ? "Unassigned" : `Cubby ${cubby}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs subtle mb-1">Style</label>
                  <select
                    value={styleByCubby[Number.parseInt(selectedStyleCubby, 10)] || "genre-artist"}
                    onChange={(e) => {
                      const cubby = Number.parseInt(selectedStyleCubby, 10);
                      if (!Number.isFinite(cubby)) return;
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
                    className="field min-w-44"
                    disabled={!cubbyNumbers.length}
                  >
                    <option value="genre-artist">Genre then artist</option>
                    <option value="artist-only">Pure artist</option>
                  </select>
                </div>

                {cubbyNumbers.length > 0 && (
                  <p className="text-xs subtle">
                    Editing {Number.parseInt(selectedStyleCubby, 10) === 0 ? "Unassigned" : `Cubby ${selectedStyleCubby}`}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/65 p-4">
              <p className="text-xs uppercase tracking-[0.2em] subtle">Cubby Rebuild</p>
              <p className="text-sm subtle mt-1">Collapse all cubbies, apply true ordering, and reform cubbies into fixed-size groups.</p>
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
        </div>
      </div>

      {showOrderingConfirm && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 px-4" onClick={() => setShowOrderingConfirm(false)}>
          <div className="panel p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Apply Ordering Fix?</h2>
            <p className="text-sm subtle mt-2">
              Found {orderingPendingCount} record(s) out of order. Apply canonical ordering using your per-cubby style rules?
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
    </div>
  );
}
