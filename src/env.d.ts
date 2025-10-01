/// <reference types="vite/client" />
/// <reference types="google.maps" />

interface ImportMetaEnv {
  readonly VITE_AIRTABLE_BASE?: string;
  readonly VITE_AIRTABLE_TABLE_ID?: string;
  readonly VITE_AIRTABLE_VIEW?: string; // view NAME for Airtable API
  readonly VITE_AIRTABLE_VIEW_ID?: string; // internal view id (optional)
  readonly VITE_AIRTABLE_TOKEN?: string;
  readonly VITE_GOOGLE_MAPS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
