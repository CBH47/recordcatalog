const DISCOGS_MIN_INTERVAL_MS = 1000;
const DISCOGS_MAX_RETRIES = 3;

type LimiterState = {
  queue: Promise<void>;
  lastRequestAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __discogsLimiterState: LimiterState | undefined;
}

function getState(): LimiterState {
  if (!global.__discogsLimiterState) {
    global.__discogsLimiterState = {
      queue: Promise.resolve(),
      lastRequestAt: 0,
    };
  }
  return global.__discogsLimiterState;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleDiscogsRequest() {
  const state = getState();

  const next = state.queue.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, DISCOGS_MIN_INTERVAL_MS - (now - state.lastRequestAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    state.lastRequestAt = Date.now();
  });

  state.queue = next.catch(() => {});
  await next;
}

export async function discogsFetch(url: string, init?: RequestInit) {
  for (let attempt = 1; attempt <= DISCOGS_MAX_RETRIES; attempt += 1) {
    await throttleDiscogsRequest();
    const res = await fetch(url, init);

    if (res.status !== 429) {
      return res;
    }

    const retryAfterHeader = res.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN;
    const backoffMs = Number.isNaN(retryAfterSeconds) ? attempt * 1200 : retryAfterSeconds * 1000;
    await sleep(backoffMs);
  }

  return fetch(url, init);
}
