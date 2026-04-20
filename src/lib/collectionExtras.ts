export type WishlistItem = {
  id: string;
  title: string;
  artist: string;
  targetPrice: string;
  notes: string;
  status: "wanted" | "acquired";
  discogsId?: number | null;
  priceSnapshots?: WishlistPriceSnapshot[];
  lastTrend?: "up" | "down" | "flat" | "unknown";
  createdAt: string;
};

export type WishlistPriceSnapshot = {
  checkedAt: string;
  discogsId: number | null;
  lowestPrice: number | null;
  medianPrice: number | null;
  currency: string | null;
  numForSale: number | null;
};

export type ListeningEntry = {
  id: string;
  recordId: number | null;
  title: string;
  artist: string;
  playedAt: string;
};

const WISHLIST_KEY = "recordcatalog_wishlist";
const LISTENING_KEY = "recordcatalog_listening_history";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
}

export function getWishlistItems(): WishlistItem[] {
  return readJson<WishlistItem[]>(WISHLIST_KEY, []);
}

export function saveWishlistItems(items: WishlistItem[]) {
  writeJson(WISHLIST_KEY, items);
}

export function addWishlistItem(input: Omit<WishlistItem, "id" | "createdAt">) {
  const existing = getWishlistItems();
  const next: WishlistItem[] = [
    {
      ...input,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    },
    ...existing,
  ];
  saveWishlistItems(next);
  return next;
}

export function removeWishlistItem(id: string) {
  const next = getWishlistItems().filter((item) => item.id !== id);
  saveWishlistItems(next);
  return next;
}

export function updateWishlistStatus(id: string, status: WishlistItem["status"]) {
  const next = getWishlistItems().map((item) => (item.id === id ? { ...item, status } : item));
  saveWishlistItems(next);
  return next;
}

export function recordWishlistPriceSnapshot(id: string, snapshot: WishlistPriceSnapshot) {
  const next = getWishlistItems().map((item) => {
    if (item.id !== id) return item;

    const previousSnapshots = item.priceSnapshots || [];
    const previousNumeric = [...previousSnapshots]
      .reverse()
      .find((entry) => typeof entry.lowestPrice === "number" && entry.lowestPrice !== null);

    let lastTrend: WishlistItem["lastTrend"] = "unknown";
    if (typeof snapshot.lowestPrice === "number" && snapshot.lowestPrice !== null && previousNumeric?.lowestPrice !== null && typeof previousNumeric?.lowestPrice === "number") {
      const delta = snapshot.lowestPrice - previousNumeric.lowestPrice;
      if (Math.abs(delta) < 0.0001) {
        lastTrend = "flat";
      } else {
        lastTrend = delta > 0 ? "up" : "down";
      }
    }

    return {
      ...item,
      discogsId: snapshot.discogsId ?? item.discogsId ?? null,
      priceSnapshots: [...previousSnapshots, snapshot].slice(-30),
      lastTrend,
    };
  });

  saveWishlistItems(next);
  return next;
}

export function getListeningEntries(): ListeningEntry[] {
  return readJson<ListeningEntry[]>(LISTENING_KEY, []);
}

export function saveListeningEntries(items: ListeningEntry[]) {
  writeJson(LISTENING_KEY, items);
}

export function addListeningEntry(input: Omit<ListeningEntry, "id" | "playedAt">) {
  const existing = getListeningEntries();
  const next: ListeningEntry[] = [
    {
      ...input,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      playedAt: new Date().toISOString(),
    },
    ...existing,
  ];
  saveListeningEntries(next);
  return next;
}

export function calculateListeningStreak(entries: ListeningEntry[]): number {
  if (!entries.length) return 0;

  const uniqueDays = Array.from(
    new Set(entries.map((entry) => entry.playedAt.slice(0, 10)))
  ).sort((a, b) => b.localeCompare(a));

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  let streak = 0;

  for (let i = 0; i < uniqueDays.length; i += 1) {
    const compare = new Date(today);
    compare.setDate(today.getDate() - i);
    const compareKey = compare.toISOString().slice(0, 10);

    if (uniqueDays[i] === compareKey) {
      streak += 1;
      continue;
    }

    if (i === 0 && uniqueDays[0] !== todayKey) {
      return 0;
    }

    break;
  }

  return streak;
}
