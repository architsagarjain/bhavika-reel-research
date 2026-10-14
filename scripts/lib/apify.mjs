// Minimal Apify REST client (built-in fetch, no SDK). Starts an actor run, waits for it, returns the dataset items.
// Async run + poll instead of run-sync, so long searches never hit the 300 second sync limit.
// Docs: https://docs.apify.com/api/v2
import { loadEnv, rel, PATHS } from "./util.mjs";

const API = "https://api.apify.com/v2";

export const ACTORS = {
  reel: "apify~instagram-reel-scraper",
  hashtag: "apify~instagram-hashtag-scraper",
};

export class ApifyError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Read APIFY_TOKEN from the environment or .env. Exits with a one-line fix when it is missing. */
export function requireToken() {
  loadEnv();
  const token = (process.env.APIFY_TOKEN ?? "").trim();
  if (!token) {
    console.error(`\nAPIFY_TOKEN is not set. Copy .env.example to .env and paste your token after APIFY_TOKEN= (get it at https://console.apify.com/settings/integrations). Looked in ${rel(PATHS.env)} and your environment.\n`);
    process.exit(2);
  }
  return token;
}

function explain(status, body) {
  const msg = body?.error?.message ? ` (${body.error.message})` : "";
  if (status === 401) return `Apify rejected the token (401)${msg}. Check APIFY_TOKEN in .env.`;
  if (status === 402) return `Apify says payment is required (402)${msg}. Your free credit or usage limit is used up: https://console.apify.com/billing`;
  if (status === 403) return `Apify refused the request (403)${msg}.`;
  if (status === 404) return `Apify could not find that actor or run (404)${msg}.`;
  if (status === 408) return `Apify timed out (408)${msg}. Try again, or lower --limit.`;
  if (status === 429) return `Apify is rate limiting (429)${msg}. Wait a minute and try again.`;
  return `Apify returned HTTP ${status}${msg}.`;
}

async function call(method, url, token, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApifyError(`Could not reach api.apify.com (${e.cause?.code ?? e.message}). Check your internet connection.`, 0);
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new ApifyError(explain(res.status, json), res.status);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run an actor and return its dataset items.
 * options.maxUsd caps what this one run may charge (Apify's maxTotalChargeUsd). options.timeoutSec caps how long we wait.
 */
export async function runActor(actor, input, { token, maxUsd = 1, timeoutSec = 900, onStatus } = {}) {
  const qs = new URLSearchParams();
  if (maxUsd) qs.set("maxTotalChargeUsd", String(maxUsd));
  const started = await call("POST", `${API}/acts/${actor}/runs?${qs}`, token, input);
  const run = started?.data;
  if (!run?.id) throw new ApifyError("Apify did not return a run id.", 0);
  const deadline = Date.now() + timeoutSec * 1000;
  let status = run.status;
  let datasetId = run.defaultDatasetId;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    if (Date.now() > deadline) throw new ApifyError(`Run ${run.id} is still ${status} after ${timeoutSec}s. See https://console.apify.com/actors/runs/${run.id}`, 0);
    const polled = await call("GET", `${API}/actor-runs/${run.id}?waitForFinish=60`, token);
    status = polled?.data?.status ?? status;
    datasetId = polled?.data?.defaultDatasetId ?? datasetId;
    if (onStatus) onStatus(status);
    if (!polled?.data) await sleep(2000);
  }
  // A run stopped by the cost cap or a timeout still has partial results worth keeping.
  const items = datasetId ? await call("GET", `${API}/datasets/${datasetId}/items?clean=true&format=json`, token) : [];
  return { runId: run.id, status, items: Array.isArray(items) ? items : [] };
}
