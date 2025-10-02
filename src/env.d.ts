/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AIRTABLE_BASE: string;
  readonly VITE_AIRTABLE_TABLE_ID: string;
  readonly VITE_AIRTABLE_VIEW_ID?: string;
  readonly VITE_GOOGLE_MAPS_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
