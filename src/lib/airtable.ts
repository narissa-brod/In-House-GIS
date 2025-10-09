// src/lib/airtable.ts

export type AirtableRecord = {
  id: string;
  createdTime: string;
  fields: Record<string, any>;
};

const BASE  = import.meta.env.VITE_AIRTABLE_BASE as string;
// Map.vue expects VITE_AIRTABLE_TABLE_ID (table ID like "tbl...") and optionally
// VITE_AIRTABLE_VIEW_ID (a view id used for UI links). For the Airtable HTTP API
// the `view` query parameter must be the view NAME (e.g. "MapExport") — not the
// internal view id. Prefer VITE_AIRTABLE_VIEW (view name) for the API request.
const TABLE_ID = import.meta.env.VITE_AIRTABLE_TABLE_ID as string;
const VIEW_ID  = import.meta.env.VITE_AIRTABLE_VIEW_ID as string | undefined;
const VIEW_NAME = import.meta.env.VITE_AIRTABLE_VIEW as string | undefined; // human-readable view name used by the API
const TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN as string;

/** Fetch one page (up to 100 records) from Airtable */
export async function fetchAirtablePage(offset?: string) {
  if (!BASE || !TABLE_ID || !TOKEN) {
    throw new Error("Missing Airtable env vars. Check .env (VITE_AIRTABLE_BASE, VITE_AIRTABLE_TABLE_ID, VITE_AIRTABLE_TOKEN)");
  }

  const url = new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE_ID)}`);
  // Airtable API expects the view name (not the internal viw... id). Use VIEW_NAME
  // if provided. If only VIEW_ID is present, we avoid sending it to the API to
  // prevent VIEW_ID_NOT_FOUND errors.
  if (VIEW_NAME) url.searchParams.set("view", VIEW_NAME);
  url.searchParams.set("pageSize", "100");
  if (offset) url.searchParams.set("offset", offset);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable ${res.status}: ${text}`);
  }

  return res.json() as Promise<{ records: AirtableRecord[]; offset?: string }>;
}

/** Fetch all records from the view (handles pagination) */
export async function fetchAllAirtable() {
  let all: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const page = await fetchAirtablePage(offset);
    all = all.concat(page.records);
    offset = page.offset;
  } while (offset);

  return all;
}