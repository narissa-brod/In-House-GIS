<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { MapboxOverlay } from '@deck.gl/mapbox';
import maplibregl from 'maplibre-gl';
import { GeoJsonLayer } from '@deck.gl/layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import { MVTLayer } from '@deck.gl/geo-layers';
import { MVTLoader } from '@loaders.gl/mvt';
import { createClient } from '@supabase/supabase-js';

// Type definitions

type ParcelRow = {
  id: number;
  apn: string | null;
  address: string | null;
  city: string | null;
  zip_code: string | null;
  county: string | null;
  owner_type: string | null; // Now contains owner name
  owner_name?: string | null;
  owner_address?: string | null;
  size_acres: number | null;
  property_url: string | null;
  property_value?: number | null;
  subdivision?: string | null;
  year_built?: number | null;
  sqft?: number | null;

  // LIR (Land Information Records) fields - for vacancy/building search
  prop_class?: string | null; // "Vacant", "Residential", "Commercial", etc.
  taxexempt_type?: string | null;
  primary_res?: string | null;
  bldg_sqft?: number | null; // Building square footage
  bldg_sqft_info?: string | null;
  floors_cnt?: number | null;
  floors_info?: string | null;
  built_yr?: number | null; // Year built (from LIR, more reliable than year_built)
  effbuilt_yr?: number | null; // Effective year built (after renovations)
  const_material?: string | null; // Construction material
  total_mkt_value?: number | null; // Total market value (land + improvements)
  land_mkt_value?: number | null; // Land-only market value
  parcel_acres?: number | null; // Parcel size from LIR (may differ from size_acres)
  house_cnt?: string | null;
  subdiv_name?: string | null;
  tax_dist?: string | null;

  geojson: { type: 'Polygon' | 'MultiPolygon'; coordinates: any };
};

declare global {
  interface Window {
    pmtiles: any;
  }
}

// Props include Airtable records and optional external filter models
const props = defineProps<{
  rows: Array<{ id: string; fields: Record<string, any> }>;
  gpChecks?: Record<string, boolean>;
  markerCityChecks?: Record<string, boolean>;
}>();

// Refs
const mapEl = ref<HTMLDivElement | null>(null);
// Support both Google Maps and MapLibre
const MAP_PROVIDER = ((import.meta.env.VITE_MAP_PROVIDER as string) || 'google').toLowerCase();
const BASEMAP_STYLE_URL = (import.meta.env.VITE_BASEMAP_STYLE_URL as string) || '';
const ENABLE_GEOCODING = String(import.meta.env.VITE_ENABLE_GEOCODING || 'false').toLowerCase() === 'true';
const GEOCODER = ((import.meta.env.VITE_GEOCODER as string) || 'maptiler').toLowerCase();
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
const MUNICIPAL_GEOJSON_URL = import.meta.env.VITE_MUNICIPAL_GEOJSON_URL as string | undefined;
const GEOCODE_CONCURRENCY = Math.max(1, Number(import.meta.env.VITE_GEOCODE_CONCURRENCY || 4));
let geocodeInFlight = 0; const geocodeWaiters: Array<() => void> = [];
async function withGeocodeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (geocodeInFlight >= GEOCODE_CONCURRENCY) {
    await new Promise<void>(resolve => geocodeWaiters.push(resolve));
  }
  geocodeInFlight++;
  try { return await fn(); } finally {
    geocodeInFlight--;
    const next = geocodeWaiters.shift();
    if (next) next();
  }
}
const map = ref<any>(null);
// Use relaxed types to support both Google and MapLibre objects without TS noise
const markers: any[] = [];
const polygons: any[] = [];
const polygonsByApn: Record<string, any> = {}; // Track polygons by APN
const markersById: Record<string, any> = {};
const infoWindowsById: Record<string, any> = {};
// Google geocoder (for provider=google)
let geocoder: google.maps.Geocoder | null = null;
const cache = new Map<string, google.maps.LatLngLiteral>();
let currentInfoWindow: any = null; // Track currently open info window (Google InfoWindow or MapLibre Popup)

// Helper: validate lat/lng objects (also used for MapLibre generic positions)
function isValidLatLng(pos: { lat: number; lng: number } | null | undefined): pos is { lat: number; lng: number } {
  if (!pos) return false;
  const { lat, lng } = pos;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return false; // skip 0,0
  return true;
}
// deck.gl overlay (GoogleMapsOverlay for Google; MapboxOverlay for MapLibre)
let deckOverlay: any = null;
const showParcels = ref(false); // Toggle for parcel layer (start disabled)
const showCounties = ref(true); // Toggle for county boundaries layer (start enabled)
const showAirtableMarkers = ref(true); // Toggle for Airtable markers (start enabled)
const showGeneralPlan = ref(false); // Toggle for Kaysville General Plan layer
const showLaytonGeneralPlan = ref(false); // Toggle for Layton General Plan layer
const showLaytonZoning = ref(false); // Toggle for Layton Zoning layer
const showKaysLegend = ref(false);
const showLaytonLegend = ref(false);
const showLaytonZoningLegend = ref(false);
const LAYTON_ZONING_ENABLED = false;
const showDavisSection = ref(false); // Collapse/expand Davis County group (default closed)
const showLaytonSection = ref(false); // Collapse/expand Layton City group (default closed)
const showKaysvilleSection = ref(false); // Collapse/expand Kaysville City group (default closed)

// General Plan filter (applies to all cities' GP layers)
const gpFilter = ref('');
// Checkbox filter model for GP (normalized labels => boolean)
const gpChecks = ref<Record<string, boolean>>({});
const showGpFilterSection = ref(false);

// Land Database markers filter (by City for now)
const markerCityChecks = ref<Record<string, boolean>>({});
const showLandFilterSection = ref(false);

const uniqueMarkerCities = computed(() => {
  const set = new Set<string>();
  for (const r of (props.rows || [])) {
    const city = String(r?.fields?.City || '').trim();
    if (city) set.add(city);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
});

// Initialize check objects when data changes
watch(() => props.rows, () => {
  const cities = new Set(uniqueMarkerCities.value);
  for (const c of cities) {
    if (!(c in markerCityChecks.value)) markerCityChecks.value[c] = true;
  }
}, { deep: true });

const selectedGpLabels = computed(() => {
  const source = props.gpChecks ?? gpChecks.value;
  return Object.entries(source)
    .filter(([, v]) => !!v)
    .map(([k]) => k.toLowerCase());
});

// Helpers to adjust filters from template
function gpSelectAll() {
  try {
    gpLegend.forEach(i => { gpChecks.value[i.label.toLowerCase()] = true; });
    laytonLegend.value.forEach(i => { gpChecks.value[i.label.toLowerCase()] = true; });
  } finally { updateDeckLayers(); }
}
function gpSelectNone() {
  try {
    Object.keys(gpChecks.value).forEach(k => { gpChecks.value[k] = false; });
  } finally { updateDeckLayers(); }
}
function gpClear() { gpFilter.value = ''; gpSelectNone(); }

function markerCitySelectAll() {
  uniqueMarkerCities.value.forEach(c => { markerCityChecks.value[c] = true; });
  plotRows(false);
}
function markerCitySelectNone() {
  uniqueMarkerCities.value.forEach(c => { markerCityChecks.value[c] = false; });
  plotRows(false);
}

// Layton overlay layers (geology, development agreements, etc.)
const showLaytonOverlays = ref({
  debris_hazards: false,
  faults: false,
  development_agreements: false
});
const laytonOverlayData = ref<Record<string, Array<{ type: 'Feature'; geometry: any; properties: any }>>>({});
const countyPolygons: google.maps.Polygon[] = []; // Store county boundary polygons
const countyLabels: google.maps.Marker[] = []; // Store county name labels

// Parcel search results state
const searchResults = ref<any[]>([]);
const showSearchResults = ref(false);
const isSearching = ref(false);
const searchError = ref('');

// Search filters (exposed via defineExpose for App.vue)
const searchFilters = ref({
  propClass: [] as string[],
  minAcres: null as number | null,
  maxAcres: null as number | null,
  minValue: null as number | null,
  maxValue: null as number | null,
  cities: [] as string[]
});

// Lightweight client-side municipal boundary support (no DB ingest required)
const municipalCache: Record<string, any> = {};
function normPlaceName(txt: string | null | undefined): string | null {
  if (!txt) return null;
  let s = txt.toUpperCase().trim().replace(/\s+/g, ' ');
  s = s.replace(/\s+(CITY|TOWN)$/i, '');
  return s;
}
async function fetchMunicipalPolygonsFor(cities: string[]): Promise<any[]> {
  const wanted = Array.from(new Set(cities.map(c => normPlaceName(c)!).filter(Boolean)));
  const toFetch = wanted.filter(n => !municipalCache[n]);
  if (toFetch.length === 0) {
    return wanted.map(n => municipalCache[n]).filter(Boolean).flat();
  }
  // Prefer static municipal GeoJSON if provided
  if (MUNICIPAL_GEOJSON_URL && !municipalCache['__ALL_STATIC__']) {
    try {
      const resp = await fetch(MUNICIPAL_GEOJSON_URL);
      if (resp.ok) {
        const geo = await resp.json();
        const feats: any[] = Array.isArray(geo?.features) ? geo.features : [];
        for (const f of feats) {
          const raw = f?.properties?.NAME || f?.properties?.CITY || f?.properties?.MUNICIPALITY || f?.properties?.LABEL || '';
          const n = normPlaceName(String(raw));
          if (!n) continue;
          if (!municipalCache[n]) municipalCache[n] = [];
          municipalCache[n].push(f);
        }
        municipalCache['__ALL_STATIC__'] = true;
      }
    } catch {}
  }
  if (wanted.every(n => municipalCache[n])) {
    return wanted.map(n => municipalCache[n]).filter(Boolean).flat();
  }
  // Query only selected cities using NAME prefix (case-insensitive)
  const whereClauses = toFetch.map(n => `upper(NAME) like '${n.replace(/'/g, "''")}%'`);
  const where = encodeURIComponent(whereClauses.join(' OR '));
  const url = `https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahMunicipalBoundaries/FeatureServer/0/query?where=${where}&outFields=NAME&returnGeometry=true&outSR=4326&f=geojson`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  let feats: any[] = [];
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (resp.ok) {
      const geo = await resp.json();
      feats = Array.isArray(geo?.features) ? geo.features : [];
    }
  } catch {}
  clearTimeout(t);

  // If targeted query failed or returned nothing, fall back to a single full fetch once
  if (feats.length === 0 && !municipalCache['__ALL__']) {
    const urlAll = `https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahMunicipalBoundaries/FeatureServer/0/query?where=1%3D1&outFields=NAME&returnGeometry=true&outSR=4326&f=geojson`;
    try {
      const respAll = await fetch(urlAll, { signal: ctrl.signal });
      if (respAll.ok) {
        const geoAll = await respAll.json();
        const allFeats: any[] = Array.isArray(geoAll?.features) ? geoAll.features : [];
        for (const f of allFeats) {
          const raw = f?.properties?.NAME || '';
          const n = normPlaceName(String(raw));
          if (!n) continue;
          if (!municipalCache[n]) municipalCache[n] = [];
          municipalCache[n].push(f);
        }
        municipalCache['__ALL__'] = true;
      }
    } catch {}
  } else {
    // Index fetched features by normalized name
    for (const f of feats) {
      const raw = f?.properties?.NAME || '';
      const n = normPlaceName(String(raw));
      if (!n) continue;
      if (!municipalCache[n]) municipalCache[n] = [];
      municipalCache[n].push(f);
    }
  }

  return wanted.map(n => municipalCache[n]).filter(Boolean).flat();
}

function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  // Ray casting
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInPolygon(pt: [number, number], geom: any): boolean {
  if (!geom) return false;
  const type = geom.type;
  if (type === 'Polygon') {
    const rings: [number, number][][] = geom.coordinates as any;
    if (!rings || rings.length === 0) return false;
    // inside outer and not in holes
    if (!pointInRing(pt, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) { if (pointInRing(pt, rings[k])) return false; }
    return true;
  } else if (type === 'MultiPolygon') {
    const polys: [number, number][][][] = geom.coordinates as any;
    for (const poly of polys) {
      if (!poly || poly.length === 0) continue;
      if (!pointInRing(pt, poly[0])) continue;
      let inHole = false;
      for (let k = 1; k < poly.length; k++) { if (pointInRing(pt, poly[k])) { inHole = true; break; } }
      if (!inHole) return true;
    }
    return false;
  }
  return false;
}
function polygonCentroid(geom: any): [number, number] | null {
  // Compute centroid of outer ring (lon/lat planar approx)
  let sumX = 0, sumY = 0, sumArea = 0;
  const rings = geom?.type === 'Polygon' ? [geom.coordinates[0]] : (geom?.type === 'MultiPolygon' ? [geom.coordinates[0][0]] : null);
  if (!rings || !rings[0]) return null;
  const ring: [number, number][] = rings[0];
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const a = x0 * y1 - x1 * y0;
    sumArea += a;
    sumX += (x0 + x1) * a;
    sumY += (y0 + y1) * a;
  }
  const area = sumArea * 0.5;
  if (Math.abs(area) < 1e-12) {
    // fallback to average
    const avg = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [avg[0] / n, avg[1] / n];
  }
  return [sumX / (6 * area), sumY / (6 * area)];
}

// Toggle deck.gl pointer behavior (parcel selection vs marker clicks)
function setDeckPointerMode(enableDeckPointer: boolean) {
  try {
    const nodes = Array.from(document.querySelectorAll('.deckgl-overlay')) as HTMLElement[];
    nodes.forEach((el) => {
      el.classList.remove('pointer-auto', 'pointer-none');
      el.classList.add(enableDeckPointer ? 'pointer-auto' : 'pointer-none');
    });
  } catch {}
}
const basemapType = ref<'streets' | 'satellite'>('streets'); // Basemap switcher

// Parcel selection state (Slice A)
const selectionEnabled = ref(false);
const selectedApns = ref<Set<string>>(new Set());
const selectedVersion = ref(0); // bump to trigger deck.gl updates
const selectionMsg = ref('');
let selectionMsgTimer: number | undefined;
const airtableMenuOpen = ref(false);
let userHasInteracted = false;

function persistSelection() {
  try {
    localStorage.setItem('cw:selected-parcels', JSON.stringify(Array.from(selectedApns.value)));
  } catch {}
}
function loadSelection() {
  try {
    const raw = localStorage.getItem('cw:selected-parcels');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) selectedApns.value = new Set(arr);
    }
  } catch {}
}
function clearSelection() {
  selectedApns.value.clear();
  selectedVersion.value++;
  persistSelection();
  updateDeckLayers();
  showSelectionMsg('Cleared');
}
function copySelectedApns() {
  const txt = Array.from(selectedApns.value).join("\n");
  if (!txt) { showSelectionMsg('No parcels selected'); return; }
  const doCopy = async () => {
    try {
      if (navigator.clipboard && (window.isSecureContext || location.hostname === 'localhost')) {
        await navigator.clipboard.writeText(txt);
      } else {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showSelectionMsg(`Copied ${selectedApns.value.size} APNs`);
    } catch (e) {
      console.warn('Clipboard copy failed', e);
      showSelectionMsg('Copy failed');
    }
  };
  doCopy();
}
async function exportSelectedCsv() {
  const apns = Array.from(selectedApns.value).filter(Boolean).map(String);
  if (apns.length === 0) { showSelectionMsg('No parcels selected'); return; }
  showSelectionMsg('Exporting?');

  // Fetch parcel details from Supabase in chunks
  const CHUNK = 500;
  const records: any[] = [];
  for (let i = 0; i < apns.length; i += CHUNK) {
    const chunk = apns.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('parcels')
      .select('*')
      .in('apn', chunk);
    if (error) {
      console.error('Failed to fetch parcels for CSV:', error);
      showSelectionMsg('Export failed');
      return;
    }
    if (data) records.push(...data);
  }

  // Map to CSV rows (ensure stable column set)
  const cols = [
    'APN','Address','City','County','ZIP','Size (acres)','Owner Name','Owner Address','Owner City','Owner State','Owner ZIP','Subdivision','Year Built','SqFt','Property URL'
  ];

  const needsQuote = (s: string) => s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r');
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return needsQuote(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines: string[] = [];
  lines.push(cols.join(','));

  for (const r of records) {
    const row = [
      r.apn,
      r.address,
      r.city,
      r.county,
      r.zip_code,
      r.size_acres,
      r.owner_name,
      r.owner_address,
      r.owner_city,
      r.owner_state,
      r.owner_zip,
      r.subdivision,
      r.year_built,
      r.sqft,
      r.property_url,
    ].map(esc).join(',');
    lines.push(row);
  }

  // Also include any APNs that didn?t return rows (keep track)
  const found = new Set(records.map(r => String(r.apn)));
  for (const apn of apns) {
    if (!found.has(apn)) {
      lines.push([apn].concat(Array(cols.length - 1).fill('')).join(','));
    }
  }

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `selected_parcels_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showSelectionMsg(`Exported ${apns.length} APNs`);
}
function showSelectionMsg(msg: string) {
  selectionMsg.value = msg;
  if (selectionMsgTimer) window.clearTimeout(selectionMsgTimer);
  selectionMsgTimer = window.setTimeout(() => { selectionMsg.value = ''; }, 1600);
}

// ===== Airtable multi-option sending =====
async function fetchSelectedParcels(): Promise<any[]> {
  const apns = Array.from(selectedApns.value).filter(Boolean).map(String);
  if (apns.length === 0) return [];
  const CHUNK = 500;
  const parcels: any[] = [];
  for (let i = 0; i < apns.length; i += CHUNK) {
    const { data, error } = await supabase.from('parcels').select('*').in('apn', apns.slice(i, i + CHUNK));
    if (error) throw error;
    if (data) parcels.push(...data);
  }
  return parcels;
}

function parcelFieldsForParcelsTable(p: any) {
  const mailingParts = [p.owner_address, p.owner_city || p.city, p.owner_state || 'UT', p.owner_zip || p.zip_code].filter(Boolean);
  const mailingAddress = mailingParts.join(', ');
  const fields: Record<string, any> = { 'APN': p.apn };
  const optional: Record<string, any> = {
    'Address': p.address,
    'City': p.city,
    'County': p.county,
    'ZIP': p.zip_code,
    'Size (acres)': p.size_acres,
    'Owner Name': p.owner_name,
    'Mailing Address': mailingAddress,
    'Property URL': p.property_url,
  };
  for (const [k, v] of Object.entries(optional)) if (v) fields[k] = v;
  return fields;
}

async function upsertParcelsInAirtable(parcels: any[]): Promise<Map<string, string>> {
  const apnToId = new Map<string, string>();
  if (!AIRTABLE_PARCELS_TABLE_ID) return apnToId;
  const apns = parcels.map((p: any) => String(p.apn)).filter(Boolean);
  const FIND_CHUNK = 10;
  for (let i = 0; i < apns.length; i += FIND_CHUNK) {
    const slice = apns.slice(i, i + FIND_CHUNK);
    const formula = 'OR(' + slice.map(a => `{APN}='${a.replace(/'/g, "\'")}'`).join(',') + ')';
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_PARCELS_TABLE_ID}`);
    url.searchParams.set('filterByFormula', formula);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
    const json = await res.json();
    if (res.ok && Array.isArray(json.records)) {
      for (const r of json.records) apnToId.set(String(r.fields?.APN || ''), r.id);
    }
    await new Promise(r => setTimeout(r, 150));
  }
  const toCreate = parcels.filter(p => !apnToId.has(String(p.apn))).map(p => ({ fields: parcelFieldsForParcelsTable(p) }));
    const CREATE_BATCH = 10;
    for (let i = 0; i < toCreate.length; i += CREATE_BATCH) {
      const batch = toCreate.slice(i, i + CREATE_BATCH);
      const resp = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_PARCELS_TABLE_ID}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch, typecast: true })
      });
    const json = await resp.json();
    if (!resp.ok) { console.error('Parcels create error', json); throw new Error('Parcels upsert failed'); }
    for (const r of json.records || []) apnToId.set(String(r.fields?.APN || ''), r.id);
    await new Promise(r => setTimeout(r, 250));
  }
  return apnToId;
}

function landFieldsForParcel(p: any) {
  const mailingParts = [p.owner_address, p.owner_city || p.city, p.owner_state || 'UT', p.owner_zip || p.zip_code].filter(Boolean);
  const mailingAddress = mailingParts.join(', ');
  const fields: Record<string, any> = { 'Name': p.address || `Parcel ${p.apn || 'Unknown'}` };
  const optional: Record<string, any> = {
    'Property Address': p.address,
    'Size (acres)': p.size_acres,
    'ZIP': p.zip_code,
    'Owner Name': p.owner_name,
    'Mailing Address': mailingAddress,
    'City': p.city,
    'County': p.county,
    'State': p.owner_state || 'UT',
    // Avoid single-selects or fields that may not exist to prevent 422 (e.g., Price, Current Zoning)
  };
  for (const [k, v] of Object.entries(optional)) if (v) fields[k] = v;
  return fields;
}

async function sendEachToLand() {
  try {
    const parcels = await fetchSelectedParcels();
    if (parcels.length === 0) { showSelectionMsg('No parcels selected'); return; }
    const apnToParcelId = await upsertParcelsInAirtable(parcels);

    // Step 1: create land records without links (more robust if link field mismatched)
    const createRecords = parcels.map(p => ({ fields: landFieldsForParcel(p) }));
    const BATCH = 10; let created = 0; const createdIds: string[] = [];
    for (let i = 0; i < createRecords.length; i += BATCH) {
      const resp = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: createRecords.slice(i, i + BATCH) })
      });
      const json = await resp.json();
      if (!resp.ok) { console.error('Land create error', json); showSelectionMsg('Airtable failed'); return; }
      const recs = json.records || [];
      created += recs.length;
      createdIds.push(...recs.map((r: any) => r.id));
      await new Promise(r => setTimeout(r, 250));
    }

    // Step 2: patch each created record with its Parcel link (if Parcel(s) exists)
    const PATCH_BATCH = 10;
    for (let i = 0; i < createdIds.length; i += PATCH_BATCH) {
      const sliceIds = createdIds.slice(i, i + PATCH_BATCH);
      const patches = sliceIds.map((id, idx) => {
        const p = parcels[i + idx];
        const pid = p ? apnToParcelId.get(String(p.apn || '')) : undefined;
        const fields: Record<string, any> = pid ? { [LAND_PARCELS_FIELD_KEY]: [{ id: pid }] } : {};
        return { id, fields };
      });
      // Skip if no links to apply
      if (patches.every(p => Object.keys(p.fields).length === 0)) continue;
      let resp = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}`, {
        method: 'PATCH', headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: patches, typecast: true })
      });
      let json = await resp.json();
      if (!resp.ok) {
        console.warn('Land link patch warning (linked-record attempt)', json);
        // Fallback: if Parcel(s) is a multi-select text field, set APN strings instead of linked IDs
        const patchesAlt = sliceIds.map((id, idx) => {
          const p = parcels[i + idx];
          const apn = p ? String(p.apn || '') : '';
          const fields: Record<string, any> = apn ? { [LAND_PARCELS_FIELD_KEY]: [apn] } : {};
          return { id, fields };
        });
        if (!patchesAlt.every(p => Object.keys(p.fields).length === 0)) {
          resp = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}`, {
            method: 'PATCH', headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: patchesAlt, typecast: true })
          });
          json = await resp.json();
          if (!resp.ok) {
            console.warn('Land link fallback (multiselect) also failed', json);
          }
        }
      }
      await new Promise(r => setTimeout(r, 250));
    }

    showSelectionMsg(`Created ${created} land records`);
    // Redirect/open newly created records (open first record + table/view)
    if (createdIds.length > 0) {
      const firstUrl = `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${createdIds[0]}`;
      window.open(firstUrl, '_blank');
    }
    const viewUrl = AIRTABLE_VIEW_ID
      ? `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${AIRTABLE_VIEW_ID}`
      : `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}`;
    window.open(viewUrl, '_blank');
  } catch (e) {
    console.error(e);
    showSelectionMsg('Airtable failed');
  }
}

async function sendEachToOwner() {
  const parcels = await fetchSelectedParcels();
  if (parcels.length === 0) { showSelectionMsg('No parcels selected'); return; }
  const BATCH = 10; let created = 0;
  for (let i = 0; i < parcels.length; i += BATCH) {
    const batch = parcels.slice(i, i + BATCH).map(p => {
      const mailingParts = [p.owner_address, p.owner_city || p.city, p.owner_state || 'UT', p.owner_zip || p.zip_code].filter(Boolean);
      const mailingAddress = mailingParts.join(', ');
      return { fields: { 'Name': p.owner_name || `Owner of ${p.apn}`, 'Owner Address': mailingAddress, 'City': p.city } };
    });
    const resp = await fetch(`https://api.airtable.com/v0/${AIRTABLE_LANDOWNER_BASE}/${AIRTABLE_LANDOWNER_TABLE_ID}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch })
    });
    const json = await resp.json();
    if (!resp.ok) { console.error('Owner create error', json); showSelectionMsg('Airtable failed'); return; }
    created += (json.records || []).length; await new Promise(r => setTimeout(r, 250));
  }
  await upsertParcelsInAirtable(parcels);
  showSelectionMsg(`Created ${created} owner records`);
}

async function linkToOneLandRecord() {
  try {
    const parcels = await fetchSelectedParcels();
    if (parcels.length === 0) { showSelectionMsg('No parcels selected'); return; }
    const apnToParcelId = await upsertParcelsInAirtable(parcels);
    const linked = Array.from(apnToParcelId.values()).filter(Boolean);

    // Ask user to choose a Land record name (avoids address mismatch across parcels)
    const firstAddr = (parcels.find(p => p?.address)?.address || '').toString().trim();
    const suggestedName = firstAddr || `Parcels (${linked.length})`;
    const inputName = (window.prompt('Enter a name for the Land record:', suggestedName) || '').toString().trim();
    const landName = inputName || suggestedName;

    // Helper to find an existing Land record by Name
    async function findLandByName(name: string): Promise<string | null> {
      try {
        const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}`);
        const formula = `{Name}='${String(name).replace(/'/g, "\\'")}'`;
        url.searchParams.set('filterByFormula', formula);
        url.searchParams.set('maxRecords', '1');
        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
        const js = await res.json();
        const id = js?.records?.[0]?.id;
        return id ? String(id) : null;
      } catch (e) { console.warn('findLandByName failed', e); return null; }
    }

    let newId = await findLandByName(landName);
    if (!newId) {
      const createResp = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: { 'Name': landName } }], typecast: true })
      });
      const createJson = await createResp.json();
      if (!createResp.ok) { console.error('Create failed', createJson); showSelectionMsg('Create failed'); return; }
      newId = (createJson.records && createJson.records[0]?.id) || '';
      if (!newId) { showSelectionMsg('Create failed'); return; }
    }
    if (linked.length > 0) {
      // Enhanced debugging for link attempt
      console.log('?? Linked array contents:', linked);
      console.log('?? Linked structure check:', {
        isArray: Array.isArray(linked),
        length: linked.length,
        firstItem: linked[0],
        firstItemStructure: JSON.stringify(linked[0])
      });

      const linkPayload = { fields: { [LAND_PARCELS_FIELD_KEY]: linked }, typecast: true };
      console.log('?? Attempting Land?Parcels link:', {
        landRecordId: newId,
        fieldKey: LAND_PARCELS_FIELD_KEY,
        fieldIsId: LAND_PARCELS_FIELD_KEY.startsWith('fld'),
        parcelIds: linked,
        payload: linkPayload,
        payloadJSON: JSON.stringify(linkPayload),
        tableId: AIRTABLE_TABLE_ID
      });

      let patchResp = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${newId}`, {
        method: 'PATCH', headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(linkPayload)
      });
      let patchJson = await patchResp.json();

      console.log('?? PATCH Response:', {
        ok: patchResp.ok,
        status: patchResp.status,
        responseData: patchJson,
        returnedFields: patchJson.fields ? Object.keys(patchJson.fields) : 'no fields',
        linkFieldInResponse: patchJson.fields?.[LAND_PARCELS_FIELD_KEY]
      });

      if (!patchResp.ok) {
        console.error('? Land?Parcels link failed:', {
          status: patchResp.status,
          response: patchJson,
          fieldKey: LAND_PARCELS_FIELD_KEY,
          error: patchJson.error
        });
        // Fallback: push APN strings into a multi-select field
        const apnStrings = parcels.map(p => String(p.apn || '')).filter(Boolean);
        if (apnStrings.length) {
          console.log('?? Attempting fallback: writing APNs as strings');
          patchResp = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${newId}`, {
            method: 'PATCH', headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { [LAND_PARCELS_FIELD_KEY]: apnStrings }, typecast: true })
          });
          patchJson = await patchResp.json();
          if (!patchResp.ok) {
            console.error('? Link fallback (multiselect) also failed', patchJson);
          } else {
            console.log('? Fallback succeeded (field is likely multi-select text, not linked records)');
          }
        }
      } else {
        console.log('? Land?Parcels link succeeded');
      }

      // Also link from the Parcels side (reciprocal), which will reflect on the Land record
      try {
        if (!AIRTABLE_PARCELS_TABLE_ID) {
          console.warn('?? Missing AIRTABLE_PARCELS_TABLE_ID; cannot link parcels to land record');
        } else {
          const parcelRecordIds = Array.from(apnToParcelId.values()).filter(Boolean);
          console.log('?? Attempting Parcels?Land link:', {
            parcelsTableId: AIRTABLE_PARCELS_TABLE_ID,
            fieldKey: PARCELS_LINK_TO_LAND_FIELD_KEY,
            fieldIsId: PARCELS_LINK_TO_LAND_FIELD_KEY.startsWith('fld'),
            landRecordId: newId,
            parcelCount: parcelRecordIds.length
          });

          const LINK_BATCH = 10;
          for (let i = 0; i < parcelRecordIds.length; i += LINK_BATCH) {
            const slice = parcelRecordIds.slice(i, i + LINK_BATCH);
            const parcelPatches = slice.map((pid) => ({
              id: pid,
              fields: { [PARCELS_LINK_TO_LAND_FIELD_KEY]: [newId] }
            }));
            console.log(`  ?? Batch ${Math.floor(i/LINK_BATCH) + 1}: Linking ${slice.length} parcels`);

            const respLink = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_PARCELS_TABLE_ID}`, {
              method: 'PATCH', headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ records: parcelPatches, typecast: true })
            });
            const jsLink = await respLink.json();

            console.log(`  ?? Parcels PATCH Response for batch ${Math.floor(i/LINK_BATCH) + 1}:`, {
              ok: respLink.ok,
              status: respLink.status,
              responseData: jsLink,
              firstRecordFields: jsLink.records?.[0]?.fields ? Object.keys(jsLink.records[0].fields) : 'no fields',
              linkFieldInFirstRecord: jsLink.records?.[0]?.fields?.[PARCELS_LINK_TO_LAND_FIELD_KEY]
            });

            if (!respLink.ok) {
              console.error(`  ? Parcels?Land link batch ${Math.floor(i/LINK_BATCH) + 1} failed:`, {
                status: respLink.status,
                response: jsLink,
                fieldKey: PARCELS_LINK_TO_LAND_FIELD_KEY,
                error: jsLink.error
              });
            } else {
              console.log(`  ? Batch ${Math.floor(i/LINK_BATCH) + 1} succeeded`);
            }
            await new Promise(r => setTimeout(r, 250));
          }
        }
      } catch (e) {
        console.error('? Failed linking from Parcels side:', e);
      }
    }

    // Optional: populate summary fields on the Land record from selection
    // Use first parcel for address/city/zip/county/state, sum size across selection
    const primary = parcels.find(p => p?.address) || parcels[0];
    const totalSize = parcels.reduce((sum, p) => sum + (Number(p.size_acres) || 0), 0);
    if (primary) {
      const mailingParts = [primary.owner_address, primary.owner_city || primary.city, primary.owner_state || 'UT', primary.owner_zip || primary.zip_code].filter(Boolean);
      const mailingAddress = mailingParts.join(', ');
      const summaryFields: Record<string, any> = {
        'Property Address': primary.address,
        'City': primary.city,
        'ZIP': primary.zip_code,
        'County': primary.county,
        'State': primary.owner_state || 'UT',
        'Owner Name': primary.owner_name,
        'Mailing Address': mailingAddress,
        'Size (acres)': totalSize || primary.size_acres,
      };
      // Strip undefined to avoid 422
      Object.keys(summaryFields).forEach(k => summaryFields[k] == null && delete summaryFields[k]);
      if (Object.keys(summaryFields).length) {
        const patchSummary = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${newId}`, {
          method: 'PATCH', headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: summaryFields, typecast: true })
        });
        const js = await patchSummary.json();
        if (!patchSummary.ok) { console.warn('Summary patch warning', js); }
      }
    }
    // Verify the links were actually created by fetching the record back
    console.log('?? Verifying links were created...');
    try {
      const verifyResp = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${newId}`, {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
      });
      const verifyData = await verifyResp.json();

      console.group('? Verification Results:');
      console.log('Land Record Fields:', verifyData.fields);
      console.log(`${LAND_PARCELS_FIELD_KEY} field value:`, verifyData.fields?.[LAND_PARCELS_FIELD_KEY]);

      const linkedParcels = verifyData.fields?.[LAND_PARCELS_FIELD_KEY];
      if (Array.isArray(linkedParcels) && linkedParcels.length > 0) {
        console.log(`? SUCCESS: ${linkedParcels.length} parcels are linked in the Land record`);
      } else {
        console.warn('?? WARNING: No parcels found linked to Land record!');
        console.log('Expected field key:', LAND_PARCELS_FIELD_KEY);
        console.log('All fields in record:', Object.keys(verifyData.fields || {}));
      }
      console.groupEnd();

      // Also verify from Parcels side
      if (AIRTABLE_PARCELS_TABLE_ID && linked.length > 0) {
        const firstParcelId = linked[0];
        const parcelVerifyResp = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_PARCELS_TABLE_ID}/${firstParcelId}`, {
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
        });
        const parcelVerifyData = await parcelVerifyResp.json();

        console.group('?? Parcel Record Verification:');
        console.log('Parcel Record Fields:', parcelVerifyData.fields);
        console.log(`${PARCELS_LINK_TO_LAND_FIELD_KEY} field value:`, parcelVerifyData.fields?.[PARCELS_LINK_TO_LAND_FIELD_KEY]);

        const linkedLand = parcelVerifyData.fields?.[PARCELS_LINK_TO_LAND_FIELD_KEY];
        if (Array.isArray(linkedLand) && linkedLand.length > 0) {
          console.log(`? SUCCESS: Parcel is linked back to Land record`);
        } else {
          console.warn('?? WARNING: Parcel is not linked to Land record!');
          console.log('Expected field key:', PARCELS_LINK_TO_LAND_FIELD_KEY);
          console.log('All fields in parcel:', Object.keys(parcelVerifyData.fields || {}));
        }
        console.groupEnd();
      }
    } catch (verifyError) {
      console.error('Verification failed:', verifyError);
    }

    showSelectionMsg(`Created Land record with ${linked.length} parcels`);
    // Open the created record directly
    const recUrl = `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${newId}`;
    window.open(recUrl, '_blank');
  } catch (e) {
    console.error(e);
    showSelectionMsg('Airtable failed');
  }
}

// Mark/unmark all visible parcels in current viewport
async function sendSelectionToAirtable() {
  const apns = Array.from(selectedApns.value).filter(Boolean).map(String);
  if (apns.length === 0) { showSelectionMsg('No parcels selected'); return; }
  try {
    showSelectionMsg('Preparing?');
    // Fetch parcel details in chunks
    const CHUNK = 500;
    const parcels: any[] = [];
    for (let i = 0; i < apns.length; i += CHUNK) {
      const { data, error } = await supabase
        .from('parcels')
        .select('*')
        .in('apn', apns.slice(i, i + CHUNK));
      if (error) { console.error(error); showSelectionMsg('Fetch failed'); return; }
      if (data) parcels.push(...data);
    }

    const buildFields = (p: any) => {
      const mailingParts = [p.owner_address, p.owner_city || p.city, p.owner_state || 'UT', p.owner_zip || p.zip_code].filter(Boolean);
      const mailingAddress = mailingParts.join(', ');
      const fields: Record<string, any> = {
        'Name': p.address || `Parcel ${p.apn || 'Unknown'}`,
      };
      const optional: Record<string, any> = {
        'Property Address': p.address,
        'APN': p.apn,
        'Size (acres)': p.size_acres,
        'ZIP': p.zip_code,
        'Owner Name': p.owner_name,
        'Mailing Address': mailingAddress,
        'City': p.city,
        'County': p.county,
        'Property URL': p.property_url,
      };
      for (const [k, v] of Object.entries(optional)) if (v) fields[k] = v;
      return fields;
    };

    const records = parcels.map(p => ({ fields: buildFields(p) }));
    const found = new Set(parcels.map(p => String(p.apn)));
    for (const apn of apns) if (!found.has(apn)) records.push({ fields: { 'Name': `Parcel ${apn}`, 'APN': apn } });

    const BATCH = 10;
    let created = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const resp = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records: batch })
      });
      const json = await resp.json();
      if (!resp.ok) { console.error('Airtable error', json); showSelectionMsg('Airtable failed'); return; }
      created += Array.isArray(json?.records) ? json.records.length : 0;
      await new Promise(r => setTimeout(r, 250));
    }
    showSelectionMsg(`Sent ${created} to Airtable`);
    const url = AIRTABLE_VIEW_ID
      ? `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${AIRTABLE_VIEW_ID}`
      : `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}`;
    window.open(url, '_blank');
  } catch (e) {
    console.error(e);
    showSelectionMsg('Airtable failed');
  }
}

function extendBoundsWithGeoJSON(bounds: google.maps.LatLngBounds, geom: any) {
  const push = (lng: number, lat: number) => bounds.extend({ lat, lng });
  if (!geom) return;
  const g = typeof geom === 'string' ? JSON.parse(geom) : geom;
  if (g.type === 'Polygon') {
    (g.coordinates || []).forEach((ring: any) => (ring || []).forEach((c: any) => push(c[0], c[1])));
  } else if (g.type === 'MultiPolygon') {
    (g.coordinates || []).forEach((poly: any) => (poly || []).forEach((ring: any) => (ring || []).forEach((c: any) => push(c[0], c[1]))));
  }
}

async function zoomToSelection() {
  if (!map.value) return;
  const apns = Array.from(selectedApns.value);
  if (apns.length === 0) { showSelectionMsg('No parcels selected'); return; }
  const bounds = MAP_PROVIDER === 'google' ? new google.maps.LatLngBounds() : null as any;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const CHUNK = 500;
  try {
    for (let i = 0; i < apns.length; i += CHUNK) {
      const chunk = apns.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('parcels')
        .select('geom')
        .in('apn', chunk);
      if (error) { console.error(error); showSelectionMsg('Zoom failed'); return; }
      (data || []).forEach((r: any) => {
        if (MAP_PROVIDER === 'google') {
          extendBoundsWithGeoJSON(bounds, r.geom);
        } else {
          const g = typeof r.geom === 'string' ? JSON.parse(r.geom) : r.geom;
          const push = (lng: number, lat: number) => {
            if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
          };
          if (g?.type === 'Polygon') {
            (g.coordinates || []).forEach((ring: any) => (ring || []).forEach((c: any) => push(c[0], c[1])));
          } else if (g?.type === 'MultiPolygon') {
            (g.coordinates || []).forEach((poly: any) => (poly || []).forEach((ring: any) => (ring || []).forEach((c: any) => push(c[0], c[1]))));
          }
        }
      });
    }
    if (MAP_PROVIDER === 'google') {
      if (!bounds.isEmpty()) {
        map.value.fitBounds(bounds);
        showSelectionMsg('Zoomed to selection');
      } else {
        showSelectionMsg('No geometry found');
      }
    } else {
      if (isFinite(minLng) && isFinite(minLat) && isFinite(maxLng) && isFinite(maxLat)) {
        map.value.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40 });
        showSelectionMsg('Zoomed to selection');
      } else {
        showSelectionMsg('No geometry found');
      }
    }
  } catch (e) { console.error(e); showSelectionMsg('Zoom failed'); }
}
function isSelected(apn?: string | null): boolean {
  if (!apn) return false;
  return selectedApns.value.has(String(apn));
}
function toggleSelect(apn?: string | null) {
  if (!apn) return;
  const key = String(apn);
  if (selectedApns.value.has(key)) selectedApns.value.delete(key); else selectedApns.value.add(key);
  selectedVersion.value++;
  persistSelection();
  updateDeckLayers();
}

// Legend types
type RGBA = [number, number, number, number];

// Canonical legend entries for Kaysville General Plan (colors match gpFillColorFor)
const gpLegend: Array<{ label: string; color: RGBA }> = [
  { label: 'Single Family Residential', color: [250, 224, 75, 160] },
  { label: 'Multifamily Residential', color: [234, 144, 49, 160] },
  { label: 'Mixed Use - Commercial/Residential', color: [120, 70, 45, 160] },
  { label: 'Mixed Use - Light Industrial/Residential', color: [255, 160, 205, 160] },
  { label: 'Commercial', color: [235, 87, 87, 160] },
  { label: 'Light Industrial/Business Park', color: [147, 63, 178, 160] },
  { label: 'Industrial', color: [147, 63, 178, 160] },
  { label: 'Civic Facilities', color: [30, 58, 138, 160] },
  { label: 'Education', color: [37, 99, 235, 160] },
  { label: 'Health Care', color: [147, 197, 253, 160] },
  { label: 'Religious', color: [186, 201, 234, 160] },
  { label: 'Utilities', color: [160, 160, 160, 160] },
  { label: 'Parks', color: [34, 197, 94, 140] },
  { label: 'Cemeteries', color: [96, 190, 120, 140] },
  { label: 'Open Space', color: [163, 196, 143, 140] },
  { label: 'Agriculture', color: [199, 230, 166, 140] },
];

function rgbaToCss([r, g, b, a]: RGBA): string {
  const alpha = Math.max(0, Math.min(1, a / 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}


// Airtable IDs from .env
const AIRTABLE_BASE = import.meta.env.VITE_AIRTABLE_BASE as string;
const AIRTABLE_TABLE_ID = import.meta.env.VITE_AIRTABLE_TABLE_ID as string;
const AIRTABLE_VIEW_ID = import.meta.env.VITE_AIRTABLE_VIEW_ID as (string | undefined);
const AIRTABLE_API_KEY = import.meta.env.VITE_AIRTABLE_TOKEN as string;

// Landowner Airtable Config (new)
const AIRTABLE_LANDOWNER_BASE = import.meta.env.VITE_AIRTABLE_LANDOWNER_BASE as string;
const AIRTABLE_LANDOWNER_TABLE_ID = import.meta.env.VITE_AIRTABLE_LANDOWNER_TABLE_ID as string;
const AIRTABLE_PARCELS_TABLE_ID = import.meta.env.VITE_AIRTABLE_PARCELS_TABLE_ID as (string | undefined);
const AIRTABLE_LAND_PARCELS_LINK_FIELD = (import.meta.env.VITE_AIRTABLE_LAND_PARCELS_LINK_FIELD as string) || 'Parcel(s)';
const AIRTABLE_LAND_PARCELS_LINK_FIELD_ID = import.meta.env.VITE_AIRTABLE_LAND_PARCELS_LINK_FIELD_ID as (string | undefined);
// Link field on Parcels table that points back to Land table (reciprocal link)
const AIRTABLE_PARCELS_LINK_TO_LAND_FIELD = (import.meta.env.VITE_AIRTABLE_PARCELS_LINK_TO_LAND_FIELD as string) || 'Land Database Link';
const AIRTABLE_PARCELS_LINK_TO_LAND_FIELD_ID = import.meta.env.VITE_AIRTABLE_PARCELS_LINK_TO_LAND_FIELD_ID as (string | undefined);
const LAND_PARCELS_FIELD_KEY = AIRTABLE_LAND_PARCELS_LINK_FIELD_ID || AIRTABLE_LAND_PARCELS_LINK_FIELD;
const PARCELS_LINK_TO_LAND_FIELD_KEY = AIRTABLE_PARCELS_LINK_TO_LAND_FIELD_ID || AIRTABLE_PARCELS_LINK_TO_LAND_FIELD;

// Diagnostic function to validate Airtable configuration
function logAirtableConfig() {
  console.group('?? Airtable Configuration');
  console.log('Base ID:', AIRTABLE_BASE);
  console.log('Land Table ID:', AIRTABLE_TABLE_ID);
  console.log('Parcels Table ID:', AIRTABLE_PARCELS_TABLE_ID);
  console.log('');
  console.log('Land?Parcels Link Field:');
  console.log('  - Field Name:', AIRTABLE_LAND_PARCELS_LINK_FIELD);
  console.log('  - Field ID:', AIRTABLE_LAND_PARCELS_LINK_FIELD_ID || '(not set)');
  console.log('  - Using:', LAND_PARCELS_FIELD_KEY, LAND_PARCELS_FIELD_KEY.startsWith('fld') ? '? (ID)' : '?? (Name)');
  console.log('');
  console.log('Parcels?Land Link Field:');
  console.log('  - Field Name:', AIRTABLE_PARCELS_LINK_TO_LAND_FIELD);
  console.log('  - Field ID:', AIRTABLE_PARCELS_LINK_TO_LAND_FIELD_ID || '(not set)');
  console.log('  - Using:', PARCELS_LINK_TO_LAND_FIELD_KEY, PARCELS_LINK_TO_LAND_FIELD_KEY.startsWith('fld') ? '? (ID)' : '?? (Name)');
  console.groupEnd();
}

// Log configuration on startup
logAirtableConfig();

// Diagnostic helper: Sample records to see actual field structure (call this from browser console)
async function debugAirtableFields(tableId: string = AIRTABLE_TABLE_ID, tableName: string = 'Land Database') {
  try {
    console.log(`Fetching sample record from ${tableName} (${tableId})...`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${tableId}?maxRecords=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });

    if (!res.ok) {
      console.error(`Failed to fetch: ${res.status} ${res.statusText}`);
      return;
    }

    const data = await res.json();
    const record = data.records?.[0];

    if (!record) {
      console.warn('No records found in table. Create at least one record first.');
      return;
    }

    console.group(`?? ${tableName} - Sample Record Fields:`);
    console.log('Record ID:', record.id);
    console.log('All field names:', Object.keys(record.fields));
    console.log('');
    console.log('Field values (link fields show as arrays of record IDs):');

    Object.entries(record.fields).forEach(([fieldName, value]) => {
      const isArray = Array.isArray(value);
      const isLinkField = isArray && value.length > 0 && typeof value[0] === 'string' && value[0].startsWith('rec');

      if (isLinkField) {
        console.log(`  ?? "${fieldName}": [${value.join(', ')}] ? LINK FIELD`);
      } else if (isArray) {
        console.log(`  ?? "${fieldName}": [${value.join(', ')}] ? Multi-select or array`);
      } else {
        console.log(`  - "${fieldName}": ${JSON.stringify(value)}`);
      }
    });
    console.groupEnd();

    // Now try to get field ID by checking the field in Airtable's UI URL format
    console.group(`?? How to get Field IDs:`);
    console.log('1. Open this table in Airtable web interface');
    console.log(`   https://airtable.com/${AIRTABLE_BASE}/${tableId}`);
    console.log('2. Click the dropdown on a column header');
    console.log('3. Select "Customize field type"');
    console.log('4. Look at the URL - it will contain the field ID like:');
    console.log('   .../${tableId}/fldXXXXXXXXX');
    console.log('');
    console.log('OR use the Airtable API Field List endpoint (if your token has access):');
    console.log(`   GET https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE}/tables`);
    console.groupEnd();

    return record;
  } catch (error) {
    console.error('Failed to fetch fields:', error);
  }
}

// Helper to check both tables
async function debugBothTables() {
  console.log('?? Checking both tables for link fields...\n');

  console.log('---------------------------------------');
  await debugAirtableFields(AIRTABLE_TABLE_ID, 'Land Database');

  console.log('\n---------------------------------------');
  if (AIRTABLE_PARCELS_TABLE_ID) {
    await debugAirtableFields(AIRTABLE_PARCELS_TABLE_ID, 'Parcels');
  } else {
    console.warn('AIRTABLE_PARCELS_TABLE_ID not set in .env');
  }

  console.log('\n---------------------------------------');
  console.log('?? SUMMARY:');
  console.log('Look for fields marked with ?? - these are your link fields');
  console.log('Copy the exact field NAMES and get their IDs from Airtable UI');
}

// Make helpers available globally for browser console debugging
(window as any).debugAirtableFields = debugAirtableFields;
(window as any).debugBothTables = debugBothTables;

// Vector Tiles URL - for low/medium zoom levels
// For Supabase Edge Function: https://your-project.supabase.co/functions/v1/parcels-tile?z={z}&x={x}&y={y}
// For local dev: serve tiles directory via Vite public folder or separate server
// For production: upload to CDN (S3/R2/Cloudflare) and version the URL
const PARCELS_TILES_URL = (import.meta.env.VITE_PARCELS_TILES_URL as string) || '/tiles/{z}/{x}/{y}.pbf';
// Visibility thresholds (env-tunable)
const PARCELS_TILES_MIN_ZOOM = Number(import.meta.env.VITE_PARCELS_TILES_MIN_ZOOM || 15); // hide parcels until fairly close
const PARCELS_GEOJSON_MIN_ZOOM = Number(import.meta.env.VITE_PARCELS_GEOJSON_MIN_ZOOM || 18); // fetch live at very high zoom
// Optional static General Plan GeoJSON served from /public
// Kaysville GP static fallback; ensure a sensible default for production builds without envs
const GP_STATIC_URL = (import.meta.env.VITE_KAYSVILLE_GP_STATIC_URL as string | undefined) || '/gp/general_plan_kaysville.geojson';
// Kaysville GP vector tiles (MVT). If provided, prefer tiles over static GeoJSON for performance
const GP_TILES_URL = (import.meta.env.VITE_KAYSVILLE_GP_TILES_URL as string | undefined);
const GP_TILES_MIN_ZOOM = Number(import.meta.env.VITE_KAYSVILLE_GP_TILES_MIN_ZOOM || 10);
const GP_TILES_MAX_ZOOM = Number(import.meta.env.VITE_KAYSVILLE_GP_TILES_MAX_ZOOM || 22);

// Layton GP vector tiles + optional static fallback
const LAYTON_GP_TILES_URL = (import.meta.env.VITE_LAYTON_GP_TILES_URL as string | undefined);
const LAYTON_GP_TILES_MIN_ZOOM = Number(import.meta.env.VITE_LAYTON_GP_TILES_MIN_ZOOM || 10);
const LAYTON_GP_TILES_MAX_ZOOM = Number(import.meta.env.VITE_LAYTON_GP_TILES_MAX_ZOOM || 22);
const LAYTON_GP_STATIC_URL = (import.meta.env.VITE_LAYTON_GP_STATIC_URL as string | undefined) || '/gp/layton_general_plan.geojson';

// Runtime flags for GP MVT fallback
let gpTileErrorCount = 0;
let gpTileLoadCount = 0;
const gpForceStatic = ref(false);
const gpUsingTiles = computed(() => !!GP_TILES_URL && !gpForceStatic.value);
const gpLaytonUsingTiles = computed(() => !!LAYTON_GP_TILES_URL);

// Dynamic legend entries for Layton (built from dataset labels)
type LegendItem = { label: string; color: RGBA };
const laytonLegend = ref<LegendItem[]>([]);
let laytonLegendLoaded = false;
async function loadLaytonLegend() {
  if (laytonLegendLoaded) return;
  try {
    const url = LAYTON_GP_STATIC_URL;
    if (!url) return;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const gj = await resp.json();

    const labels = new Set<string>();
    const add = (p: any) => {
      const raw = gpZoneFromProps(p);
      if (raw) labels.add(laytonNormalize(String(raw)));
    };
    const feats = Array.isArray(gj?.features) ? gj.features : [];
    for (const f of feats) add(f.properties || {});

    const items: LegendItem[] = [];
    for (const lbl of Array.from(labels).sort((a, b) => a.localeCompare(b))) {
      items.push({ label: lbl, color: gpFillColorFor(lbl) });
      if (items.length >= 24) break; // keep legend manageable
    }
    laytonLegend.value = items;
    laytonLegendLoaded = true;
  } catch {}
}

// Map raw label to canonical Layton legend string
function laytonNormalize(label: string): string {
  const t = label.toString().trim().toLowerCase();
  if (t.includes('apz agriculture')) return 'APZ Agriculture';
  if (t.includes('apz industrial')) return 'APZ Industrial';
  if (t.includes('apz manufacturing')) return 'APZ Manufacturing';
  if (t.includes('apz institutional')) return 'APZ Institutional Use';
  if (t === 'apz' || t.includes('accident potential')) return 'APZ';
  if (t.includes('approved development')) return 'Approved Development';
  if (t.includes('business park expansion')) return 'Business Park Expansion Area';
  if (t.includes('business park/mixed use') || (t.includes('business') && t.includes('mixed'))) return 'Business Park/Mixed Use';
  if (t.includes('business/research park') || t.includes('business & research park')) return 'Business/Research Park';
  if (t.includes('community residential')) return 'Community Residential';
  if (t.includes('condo/apartment')) return 'Condo/Apartment';
  if (t.includes('condo/townhouse')) return 'Condo/Townhouse';
  if (t.includes('hill afb')) return 'Hill AFB Easement Area';
  if (t.includes('industrial flex')) return 'Industrial Flex';
  if (t.includes('institutional use')) return 'Institutional Use';
  if (t.includes('low density residential')) return 'Low Density Residential';
  if (t.includes('manufacturing')) return 'Manufacturing';
  if (t.includes('mixed use corridor')) return 'Mixed Use Corridors';
  if (t === 'mixed use' || (t.startsWith('mixed') && !t.includes('corridor'))) return 'Mixed Use';
  if (t.includes('neighborhood ag') || t.includes('heritage overlay')) return 'Neighborhood Ag Heritage Overlay/Low Density Residential';
  if (t.includes('neighborhood residential')) return 'Neighborhood Residential';
  if (t.includes('open space') || t.includes('public facility')) return 'Open Space/Public Facilities';
  if (t.includes('professional business')) return 'Professional Business';
  if (t.includes('residential community')) return 'Residential Community';
  if (t.includes('residential low')) return 'Residential Low Density';
  if (t.includes('residential neighborhood') || t === 'residential') return 'Residential Neighborhood';
  if (t.includes('school')) return 'School';
  if (t.includes('town center')) return 'Town Center';
  if (t.includes('transitional residential')) return 'Transitional Residential';
  if (t.includes('urban district')) return 'Urban District';
  if (t.includes('agriculture')) return 'Agriculture';
  if (t.includes('commercial')) return 'Commercial';
  return label.toString();
}

function gpFillColorFor(zoneType: string | null | undefined): [number, number, number, number] {
  const canonical = laytonNormalize((zoneType || '').toString());
  const z = canonical.toLowerCase();
  // Layton palette from provided legend (approximated RGBA)
  const layton: Record<string, [number, number, number, number]> = {
    'apz': [150, 150, 150, 100],
    'apz agriculture': [183, 228, 161, 180],
    'apz industrial': [174, 236, 239, 180],
    'apz manufacturing': [154, 160, 166, 180],
    'apz institutional use': [196, 241, 244, 180],
    'agriculture': [116, 196, 118, 180],
    'approved development': [126, 34, 206, 200],
    'business park expansion area': [34, 197, 94, 190],
    'business park/mixed use': [30, 64, 175, 200],
    'business/research park': [37, 99, 235, 200],
    'commercial': [239, 68, 68, 210],
    'community residential': [217, 119, 6, 200],
    'condo/apartment': [154, 109, 47, 200],
    'condo/townhouse': [245, 158, 11, 200],
    'hill afb easement area': [107, 114, 128, 160],
    'industrial flex': [75, 85, 99, 190],
    'institutional use': [147, 197, 253, 190],
    'low density residential': [255, 245, 161, 200],
    'manufacturing': [55, 65, 81, 210],
    'mixed use': [168, 85, 247, 200],
    'mixed use corridors': [251, 191, 36, 200],
    'neighborhood ag heritage overlay/low density residential': [217, 249, 157, 200],
    'neighborhood residential': [253, 224, 71, 200],
    'open space/public facilities': [132, 204, 22, 170],
    'professional business': [163, 196, 234, 190],
    'residential community': [249, 168, 212, 190],
    'residential low density': [254, 202, 202, 190],
    'residential neighborhood': [167, 243, 208, 190],
    'school': [59, 130, 246, 200],
    'town center': [185, 28, 28, 210],
    'transitional residential': [250, 204, 21, 200],
    'urban district': [127, 29, 29, 210],
    'others': [156, 163, 175, 180],
  };
  if (layton[z]) return layton[z];
  const dict: Record<string, [number, number, number, number]> = {
    'single family residential': [250, 224, 75, 160],
    'single-family residential': [250, 224, 75, 160],
    'single family':             [250, 224, 75, 160],
    'multifamily residential':   [234, 144, 49, 160],
    'multi-family residential':  [234, 144, 49, 160],
    'multifamily':               [234, 144, 49, 160],
    'mixed use - commercial/residential': [120, 70, 45, 160],
    'mixed use – commercial/residential': [120, 70, 45, 160],
    'mixed use commercial/residential':   [120, 70, 45, 160],
    'mixed use - light industrial/residential': [255, 160, 205, 160],
    'mixed use – light industrial/residential': [255, 160, 205, 160],
    'mixed use light industrial/residential':   [255, 160, 205, 160],
    'commercial':                 [235, 87, 87, 160],
    'light industrial/business park': [147, 63, 178, 160],
    'light industrial / business park': [147, 63, 178, 160],
    'industrial':                 [147, 63, 178, 160],
    'civic facilities':           [30, 58, 138, 160],
    'education':                  [37, 99, 235, 160],
    'health care':                [147, 197, 253, 160],
    'religious':                  [186, 201, 234, 160],
    'utilities':                  [160, 160, 160, 160],
    'parks':                      [34, 197, 94, 140],
    'cemeteries':                 [96, 190, 120, 140],
    'open space':                 [163, 196, 143, 140],
    'agriculture':                [199, 230, 166, 140],
  };
  if (dict[z]) return dict[z];
  // Broader fallbacks to support datasets like Layton (e.g., "Community Residential", "Residential Uses")
  if (z.includes('residential uses')) return dict['single family residential'];
  if (z.includes('community residential')) return dict['single family residential'];
  if (z === 'residential') return dict['single family residential'];
  if (z.includes('residential')) return dict['single family residential'];
  if (z.includes('single') && z.includes('res')) return dict['single family residential'];
  if (z.includes('multi') && z.includes('res')) return dict['multifamily residential'];
  if (z.includes('mixed') && z.includes('commercial')) return dict['mixed use - commercial/residential'];
  if (z.startsWith('mixed') || z.includes('mixed-use') || z.includes('mixed use')) return dict['mixed use - commercial/residential'];
  if (z.includes('mixed') && z.includes('industrial')) return dict['mixed use - light industrial/residential'];
  if (z.includes('industrial flex')) return dict['light industrial/business park'];
  if (z.includes('business park')) return dict['light industrial/business park'];
  if (z.includes('industrial')) return dict['industrial'];
  if (z.includes('neighborhood commercial') || z.includes('regional commercial')) return dict['commercial'];
  if (z.includes('civic')) return dict['civic facilities'];
  if (z.includes('public facilities') || z.includes('public/semi') || z.includes('institutional')) return dict['civic facilities'];
  if (z.includes('educ')) return dict['education'];
  if (z.includes('health')) return dict['health care'];
  if (z.includes('relig')) return dict['religious'];
  if (z.includes('utilit')) return dict['utilities'];
  if (z.includes('cemet')) return dict['cemeteries'];
  if (z.includes('parks and open space')) return dict['open space'];
  if (z.includes('park')) return dict['parks'];
  if (z.includes('open')) return dict['open space'];
  if (z.includes('agric')) return dict['agriculture'];
  if (z.includes('comm')) return dict['commercial'];
  // More visible default fill
  return [150, 150, 150, 160];
}

// Extract a best-effort zone label from various data sources (Kaysville, Layton, etc.)
function gpZoneFromProps(props: any): string | null {
  if (!props) return null;
  return (
    props.zone_type ||
    props.Zone_Type ||
    props.zone || props.Zone ||
    props.General_Plan || props.general_plan ||
    props.GeneralizeCategory || props.generalizecategory ||
    props.LAND_USE || props.land_use ||
    props.category || props.Category ||
    null
  );
}

// Determine if a feature's zone matches current filter
function zoneMatchesFilter(props: any): boolean {
  const label = laytonNormalize(String(gpZoneFromProps(props) || '')).toLowerCase();
  const selected = selectedGpLabels.value;
  if (selected.length > 0) {
    // If any checkbox is selected, use category-aware matching
    return selected.some(sel => sameCategory(sel, label));
  }
  const q = gpFilter.value.trim().toLowerCase();
  if (!q) return true;
  return label.includes(q);
}

// Category-aware comparison to unify across cities (e.g., Single Family vs Low Density Residential)
function sameCategory(selectedNorm: string, labelNorm: string): boolean {
  const s = selectedNorm.toLowerCase();
  const l = labelNorm.toLowerCase();
  // Single-family group
  if ((s.includes('single') && s.includes('res')) || s.includes('low density residential')) {
    if (l.includes('single') && l.includes('res')) return true;
    if (l.includes('residential low')) return true;
    if (l.includes('low density') && l.includes('residential')) return true;
    if (l.includes('neighborhood residential')) return true;
    if (l.includes('neighborhood ag heritage overlay/low density residential')) return true;
    if (l === 'residential' || l.includes('community residential') || l.includes('residential uses')) return true;
  }
  // Multifamily group
  if (s.includes('multi') && s.includes('res')) {
    if (l.includes('multi') && l.includes('res')) return true;
    if (l.includes('condo') || l.includes('apartment') || l.includes('townhouse')) return true;
  }
  // Commercial group
  if (s.includes('commercial')) {
    if (l.includes('commercial')) return true;
    if (l.includes('town center') || l.includes('mixed use') && l.includes('commercial')) return true;
  }
  // Industrial group
  if (s.includes('industrial')) {
    if (l.includes('industrial') || l.includes('business park')) return true;
    if (l.includes('industrial flex')) return true;
  }
  // Parks/Open Space group
  if (s.includes('park') || s.includes('open space')) {
    if (l.includes('park') || l.includes('open space')) return true;
  }
  // Agriculture
  if (s.includes('agric')) {
    if (l.includes('agric')) return true;
  }
  // Civic / Institutional
  if (s.includes('civic')) {
    if (l.includes('civic')) return true;
    if (l.includes('public facilities') || l.includes('public/semi') || l.includes('institutional')) return true;
  }
  if (s.includes('institutional')) {
    if (l.includes('institutional') || l.includes('public facilities')) return true;
  }
  // Education / Schools
  if (s.includes('education') || s.includes('school')) {
    if (l.includes('educat') || l.includes('school')) return true;
  }
  // Health Care
  if (s.includes('health')) {
    if (l.includes('health')) return true;
  }
  // Religious
  if (s.includes('relig')) {
    if (l.includes('relig')) return true;
  }
  // Utilities / Infrastructure
  if (s.includes('utilit')) {
    if (l.includes('utilit')) return true;
  }
  // Cemeteries
  if (s.includes('cemet')) {
    if (l.includes('cemet')) return true;
  }
  // Town Center / Urban Core
  if (s.includes('town center') || s.includes('urban district')) {
    if (l.includes('town center') || l.includes('urban district')) return true;
  }
  // Professional Business
  if (s.includes('professional business')) {
    if (l.includes('professional business')) return true;
  }
  // APZ
  if (s === 'apz' || s.includes('accident potential')) {
    if (l === 'apz' || l.includes('accident potential') || l.startsWith('apz ')) return true;
  }
  // Fallback: strict equality
  return s === l;
}

function createGeneralPlanStaticLayer() {
  if (!GP_STATIC_URL) return null;
  return new GeoJsonLayer({
    id: 'general-plan-static',
    data: GP_STATIC_URL,
    filled: true,
    getFillColor: (f: any) => gpFillColorFor(gpZoneFromProps(f.properties)),
    stroked: true,
    getLineColor: [40, 40, 40, 200],
    lineWidthMinPixels: 1,
    pickable: true,
    extensions: [new DataFilterExtension({ filterSize: 1 })],
    getFilterValue: (f: any) => zoneMatchesFilter(f.properties) ? 1 : 0,
    filterRange: [1, 1],
    onClick: (info: any) => {
      if (!info?.object) return;
      showGeneralPlanPopup(info.object.properties || {}, info.coordinate);
    },
    updateTriggers: {
      getFillColor: [(f: any) => String(gpZoneFromProps(f.properties) || '').toLowerCase()],
      getFilterValue: [() => gpFilter.value],
    }
  });
}

// Prefer MVT for performance if URL provided
function createGeneralPlanLayer() {
  if (!gpForceStatic.value && GP_TILES_URL) {
    return new MVTLayer({
      id: 'general-plan-tiles',
      data: GP_TILES_URL,
      loaders: [MVTLoader],
      minZoom: GP_TILES_MIN_ZOOM,
      maxZoom: GP_TILES_MAX_ZOOM,
      pickable: true,
      loadOptions: { mvt: { shape: 'binary' } },
      getFillColor: (f: any) => gpFillColorFor(gpZoneFromProps(f.properties)),
      getLineColor: [40, 40, 40, 200],
      lineWidthMinPixels: 1,
      extensions: [new DataFilterExtension({ filterSize: 1 })],
      getFilterValue: (f: any) => zoneMatchesFilter(f.properties) ? 1 : 0,
      filterRange: [1, 1],
      onTileLoad: (tile: any) => {
        gpTileLoadCount++;
        // console.log('GP MVT tile loaded', tile?.x, tile?.y, tile?.z);
      },
      onTileError: (err: any) => {
        // Many tile servers/buckets return 400/404 for tiles outside the data footprint.
        // Treat those as benign (skip), not a fatal error that triggers fallback.
        const msg = String(err && (err.message || err)).toLowerCase();
        const isMissing = msg.includes('(400)') || msg.includes('400') || msg.includes('404');
        if (!isMissing) {
          gpTileErrorCount++;
          console.warn('GP MVT tile error', err);
        }
        // Only fall back if we see multiple non-missing errors and no successful loads
        if (gpTileErrorCount >= 3 && gpTileLoadCount === 0) {
          gpForceStatic.value = true;
          console.warn('Falling back to static General Plan GeoJSON');
          updateDeckLayers();
        }
      },
      // If your MBTiles used a specific layer name, you can restrict to it for safety.
      // loadOptions: { mvt: { layers: ['gplan'] } },
      onClick: (info: any) => {
        if (!info?.object) return;
        showGeneralPlanPopup(info.object.properties || {}, info.coordinate);
      },
      updateTriggers: {
        getFillColor: [(f: any) => String(gpZoneFromProps(f.properties) || '').toLowerCase()],
        getFilterValue: [() => gpFilter.value],
      }
    });
  }
  return createGeneralPlanStaticLayer();
}

// Layton General Plan tiles layer
function createLaytonGeneralPlanLayer() {
  if (!LAYTON_GP_TILES_URL) return createLaytonGeneralPlanStaticLayer();
  return new MVTLayer({
    id: 'layton-general-plan-tiles',
    data: LAYTON_GP_TILES_URL,
    loaders: [MVTLoader],
    minZoom: LAYTON_GP_TILES_MIN_ZOOM,
    maxZoom: LAYTON_GP_TILES_MAX_ZOOM,
    pickable: true,
    loadOptions: { mvt: { shape: 'binary' } },
    filled: true,
    stroked: true,
    getFillColor: (f: any) => gpFillColorFor(gpZoneFromProps(f.properties)),
    getLineColor: [40, 40, 40, 200],
    lineWidthMinPixels: 2,
    extensions: [new DataFilterExtension({ filterSize: 1 })],
    getFilterValue: (f: any) => zoneMatchesFilter(f.properties) ? 1 : 0,
    filterRange: [1, 1],
    onTileError: (err: any) => {
      const msg = String(err && (err.message || err)).toLowerCase();
      const isMissing = msg.includes('(400)') || msg.includes('400') || msg.includes('404');
      if (!isMissing) console.warn('Layton GP MVT tile error', err);
    },
    onClick: (info: any) => {
      if (!info?.object) return;
      showGeneralPlanPopup(info.object.properties || {}, info.coordinate);
    },
    updateTriggers: {
      getFillColor: [(f: any) => String(gpZoneFromProps(f.properties) || '').toLowerCase()],
      getFilterValue: [() => gpFilter.value],
    }
  });
}

// Layton GP static fallback
function createLaytonGeneralPlanStaticLayer() {
  if (!LAYTON_GP_STATIC_URL) return null;
  return new GeoJsonLayer({
    id: 'layton-general-plan-static',
    data: LAYTON_GP_STATIC_URL,
    filled: true,
    stroked: true,
    getFillColor: (f: any) => gpFillColorFor(gpZoneFromProps(f.properties)),
    getLineColor: [40, 40, 40, 200],
    lineWidthMinPixels: 2,
    pickable: true,
    extensions: [new DataFilterExtension({ filterSize: 1 })],
    getFilterValue: (f: any) => zoneMatchesFilter(f.properties) ? 1 : 0,
    filterRange: [1, 1],
    onClick: (info: any) => {
      if (!info?.object) return;
      showGeneralPlanPopup(info.object.properties || {}, info.coordinate);
    },
    updateTriggers: {
      getFillColor: [(f: any) => String(gpZoneFromProps(f.properties) || '').toLowerCase()],
      getFilterValue: [() => gpFilter.value],
    }
  });
}

// Layton Zoning layer (from ArcGIS REST service)
const LAYTON_ZONING_URL = import.meta.env.VITE_LAYTON_ZONING_URL as string | undefined;
const laytonZoningData = ref<any>(null);
const laytonZoningLegend = ref<Array<{ label: string; color: RGBA }>>([]);

async function fetchLaytonZoning() {
  if (!LAYTON_ZONING_URL) return;
  if (laytonZoningData.value) return; // Already loaded

  try {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      f: 'geojson',
      outSR: '4326'
    });
    const url = `${LAYTON_ZONING_URL}?${params}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
    const geojson = await resp.json();
    laytonZoningData.value = geojson;

    // Build legend from unique zones
    const zones = new Set<string>();
    (geojson.features || []).forEach((f: any) => {
      const zone = f.properties?.Zone || '';
      if (zone) zones.add(String(zone));
    });

    const legendItems: Array<{ label: string; color: RGBA }> = [];
    Array.from(zones).sort().forEach(zone => {
      legendItems.push({ label: zone, color: getLaytonZoningColor(zone) });
    });
    laytonZoningLegend.value = legendItems;
  } catch (error) {
    console.error('Failed to load Layton zoning data:', error);
  }
}

function getLaytonZoningColor(zone: string): RGBA {
  const z = String(zone).toUpperCase();
  // Residential zones
  if (z.includes('R-1')) return [255, 251, 147, 160]; // Light yellow
  if (z.includes('R-2')) return [255, 224, 130, 160]; // Yellow-orange
  if (z.includes('R-3') || z.includes('RM')) return [255, 183, 77, 160]; // Orange
  // Commercial
  if (z.includes('C-')) return [239, 83, 80, 160]; // Red
  if (z.includes('NC')) return [244, 143, 177, 160]; // Pink
  // Industrial
  if (z.includes('M-') || z.includes('BP')) return [149, 117, 205, 160]; // Purple
  // Public/Open Space
  if (z.includes('P-') || z.includes('OS')) return [129, 199, 132, 160]; // Green
  // Agricultural
  if (z.includes('A-')) return [220, 231, 117, 160]; // Light green
  // Mixed Use
  if (z.includes('MU')) return [121, 85, 72, 160]; // Brown
  // Default
  return [189, 189, 189, 160]; // Gray
}

function createLaytonZoningLayer() {
  if (!laytonZoningData.value) return null;
  return new GeoJsonLayer({
    id: 'layton-zoning',
    data: laytonZoningData.value,
    filled: true,
    stroked: true,
    getFillColor: (f: any) => getLaytonZoningColor(f.properties?.Zone || ''),
    getLineColor: [60, 60, 60, 200],
    lineWidthMinPixels: 1,
    pickable: true,
    onClick: (info: any) => {
      if (!info?.object) return;
      showLaytonZoningPopup(info.object.properties || {}, info.coordinate);
    },
    updateTriggers: {
      getFillColor: [(f: any) => String(f.properties?.Zone || '')],
    }
  });
}

// Create Layton overlay layers (faults, development agreements)
function createLaytonOverlayLayers(): any[] {
  const layers: any[] = [];

  // Debris Hazards - outline only (no fill), classic orange
  if (showLaytonOverlays.value.debris_hazards && laytonOverlayData.value.debris_hazards) {
    const geojson = { type: 'FeatureCollection', features: laytonOverlayData.value.debris_hazards };
    layers.push(
      new GeoJsonLayer({
        id: 'layton-overlay-debris_hazards',
        data: geojson as any,
        filled: false,
        stroked: true,
        getLineColor: (f: any) => {
          const hex = (f?.properties?.layer_color || '#ffa500').toString().replace('#','');
          const v = hex.length === 6 ? parseInt(hex, 16) : 0xFFA500;
          const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
          return [r, g, b, 255] as [number, number, number, number];
        },
        lineWidthMinPixels: 2,
        pickable: true,
        parameters: { depthTest: false },
        onClick: (info: any) => {
          if (!info?.object) return;
          showLaytonOverlayPopup(info.object.properties || {}, info.coordinate, 'Debris Hazards');
        }
      })
    );
  }

  // Geological Faults - Line features
  if (showLaytonOverlays.value.faults && laytonOverlayData.value.faults) {
    const geojson = { type: 'FeatureCollection', features: laytonOverlayData.value.faults };
    layers.push(
      new GeoJsonLayer({
        id: 'layton-overlay-faults',
        data: geojson as any,
        filled: false,
        stroked: true,
        getLineColor: () => [139, 0, 255, 255] as [number, number, number, number], // Solid purple
        lineWidthMinPixels: 2,
        pickable: true,
        onClick: (info: any) => {
          if (!info?.object) return;
          showLaytonOverlayPopup(info.object.properties || {}, info.coordinate, 'Geological Faults');
        }
      })
    );
  }

  // Development Agreements - Thick dashed outline, no fill
  if (showLaytonOverlays.value.development_agreements && laytonOverlayData.value.development_agreements) {
    const geojson = { type: 'FeatureCollection', features: laytonOverlayData.value.development_agreements };
    layers.push(
      new GeoJsonLayer({
        id: 'layton-overlay-development_agreements',
        data: geojson as any,
        filled: true, // add translucent fill so interior is clickable
        stroked: true,
        getFillColor: () => [30, 144, 255, 60] as [number, number, number, number], // subtle fill for click target
        getLineColor: () => [30, 144, 255, 255] as [number, number, number, number], // Dodger blue (different from parcels)
        lineWidthMinPixels: 4,
        // Use proper dash props for GeoJsonLayer (PathLayer under the hood)
        getLineDashArray: () => [8, 4] as [number, number],
        lineDashJustified: true,
        parameters: { depthTest: false },
        pickable: true,
        onClick: (info: any) => {
          if (!info?.object) return;
          showLaytonOverlayPopup(info.object.properties || {}, info.coordinate, 'Development Agreements');
        }
      })
    );
  }

  return layers;
}

// Show popup for Layton overlay features
function showLaytonOverlayPopup(props: any, coordinate: [number, number], layerTitle: string) {
  if (!map.value) return;
  if (currentInfoWindow && MAP_PROVIDER === 'google') currentInfoWindow.close();

  // Define relevant fields per layer type
  const relevantFields: Record<string, string[]> = {
    'Debris Hazards': ['ZONE_TYPE', 'ZONE_CLASS', 'SOURCE', 'COMMENTS'],
    'Geological Faults': ['FAULT_NAME', 'FAULT_TYPE', 'CERTAINTY', 'AGE', 'SLIP_RATE'],
    'Development Agreements': ['AGREEMENTNAME', 'AGREEMENT_NAME', 'NAME', 'SUBDIVISION', 'DEVELOPER', 'STATUS', 'ORDINANCE', 'ORDINANCENUMBER', 'APPROVAL_DATE', 'EXPIRATION_DATE']
  };

  const fieldsToShow = relevantFields[layerTitle] || [];

  // Prefer clearer title when available
  const displayTitle = layerTitle === 'Development Agreements'
    ? (props.AgreementName || props.AGREEMENT_NAME || props.Name || layerTitle)
    : layerTitle;

  // Build property list from the feature properties, filtering for relevant fields
  const properties = Object.entries(props)
    .filter(([key]) => {
      // Skip internal fields
      if (key.startsWith('_') || ['layer_name', 'layer_title', 'layer_color', 'id'].includes(key)) return false;
      // If we have a whitelist for this layer, only show those fields
      if (fieldsToShow.length > 0) {
        return fieldsToShow.some(field => key.toUpperCase().includes(field.toUpperCase()));
      }
      // Otherwise show all non-internal fields
      return true;
    })
    .map(([key, value]) => {
      const displayKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const displayValue = value != null && value !== '' ? String(value) : '?';
      return `<div style="color:#6b7280; margin-bottom:0.25rem; font-size:0.875rem;">${displayKey}: <span style="color:#111827; font-weight:400;">${displayValue}</span></div>`;
    })
    .join('');

  // Determine color badge based on layer
  const badgeColors: Record<string, string> = {
    'Debris Hazards': '#ffa500',
    'Geological Faults': '#8b00ff',
    'Development Agreements': '#1e90ff'
  };
  const badgeColor = badgeColors[layerTitle] || '#059669';

  const html = `
    <div class="cw-popup" style="width:22rem; max-width:90vw; color:#111827; padding:0.75rem; box-sizing:border-box; margin:0 auto;">
      <div style="font-size:0.6875rem; color:${badgeColor}; text-transform:uppercase; letter-spacing:0.05rem; margin-bottom:0.5rem;">
        <svg width="10" height="10" viewBox="0 0 12 12" style="display:inline-block; vertical-align:middle; margin-right:0.25rem; margin-bottom:0.125rem;"><circle cx="6" cy="6" r="5" fill="${badgeColor}"/></svg>
        <span>${layerTitle.toUpperCase()}</span>
      </div>
      <div style="font-size:1.125rem; font-weight:600; letter-spacing:-0.01rem; line-height:1.3; margin-bottom:0.75rem; word-wrap:break-word;">${String(displayTitle)}</div>
      ${properties ? `<div style="margin-bottom:0.75rem;">${properties}</div>` : '<div style="text-align:center; font-size:0.875rem; color:#6b7280; padding:1rem 0;">No additional information available</div>'}
    </div>
  `;

  if (MAP_PROVIDER === 'google') {
    const infoWindow = new google.maps.InfoWindow({
      content: html,
      position: { lat: coordinate[1], lng: coordinate[0] }
    });
    // Center the map under the popup for better UX
    try { map.value.panTo({ lat: coordinate[1], lng: coordinate[0] }); } catch {}
    infoWindow.open(map.value);
    currentInfoWindow = infoWindow;
  } else if (MAP_PROVIDER === 'maplibre') {
    try {
      const popup = new (maplibregl as any).Popup({
        closeButton: true,
        maxWidth: '360px',
        offset: 25
      })
        .setLngLat([coordinate[0], coordinate[1]])
        .setHTML(html)
        .addTo(map.value);

      // Center the map on the popup location with slight upward offset for better visibility
      try {
        const point = map.value.project([coordinate[0], coordinate[1]]);
        const offsetPoint = { x: point.x, y: point.y - 150 };
        const newCenter = map.value.unproject(offsetPoint);
        map.value.easeTo({ center: [newCenter.lng, newCenter.lat], duration: 350 });
      } catch {}

      currentInfoWindow = popup;
    } catch (e) {
      console.warn('Popup error:', e);
    }
  }
}

function showLaytonZoningPopup(props: any, coordinate: [number, number]) {
  if (!map.value) return;
  if (currentInfoWindow && MAP_PROVIDER === 'google') currentInfoWindow.close();

  const zone = props.Zone || 'Unknown';
  const generalDesc = props.GeneralDescription || '';
  const detailedDesc = props.DetailedDescription || '';

  const html = `
    <div class="cw-popup" style="min-width:18rem; max-width:24rem; color:#111827; margin-bottom: 0.5rem; padding:0.5rem;">
      <div style="text-align:center; font-size:0.75rem; font-weight:700; color:#f59e0b; text-transform:uppercase; letter-spacing:0.05rem; margin-bottom:0.375rem;">
        Layton City Zoning
      </div>
      <div style="text-align:center; font-size:1.0625rem; font-weight:700; line-height:1.25; margin-bottom:0.25rem;">${String(zone)}</div>
      ${generalDesc ? `<div style="text-align:center; font-size:0.9rem; color:#6b7280; font-weight:400; margin-bottom:0.375rem;">${String(generalDesc)}</div>` : ''}
      ${detailedDesc ? `<div style="text-align:center; font-size:0.8125rem; color:#4b5563; margin-bottom:0.25rem;">${String(detailedDesc)}</div>` : ''}
    </div>
  `;

  if (MAP_PROVIDER === 'google') {
    const infoWindow = new google.maps.InfoWindow({
      content: html,
      position: { lat: coordinate[1], lng: coordinate[0] }
    });
    infoWindow.open(map.value);
    currentInfoWindow = infoWindow;
  }
}

function showGeneralPlanPopup(props: any, coordinate: [number, number]) {
  if (!map.value) return;
  if (currentInfoWindow && MAP_PROVIDER === 'google') currentInfoWindow.close();

  // Resolve zone label from multiple possible fields (Kaysville, Layton, etc.)
  const zoneName = gpZoneFromProps(props) || props.zone_name || props.name || props.zone_code || 'Zone';
  const zoneType = props.zone_type || props.Zone_Type || '';
  const county = props.county || '';
  const city = props.city || '';

  // Optional Layton fields
  const acresRaw = props.Acres ?? props.acres;
  const acresText = typeof acresRaw === 'number'
    ? `${acresRaw.toFixed(2)} acres`
    : acresRaw ? `${Number(parseFloat(String(acresRaw))).toFixed(2)} acres` : '';
  const moreInfo = props.MoreInformation || props.moreInformation || '';
  const generalized = props.GeneralizeCategory || props.GeneralizedCategory || props.generalizecategory || '';

  const html = `
    <div class="cw-popup" style="min-width:18rem; max-width:24rem; color:#111827; margin-bottom: 0.5rem; padding:0.5rem;">
      <div style="text-align:center; font-size:0.75rem; font-weight:700; color:#6366f1; text-transform:uppercase; letter-spacing:0.05rem; margin-bottom:0.375rem;">
        General Plan Zone
      </div>
      <div style="text-align:center; font-size:1.0625rem; font-weight:700; line-height:1.25; margin-bottom:0.25rem;">${String(zoneName)}</div>
      ${zoneType ? `<div style=\"text-align:center; font-size:0.9rem; color:#6b7280; font-weight:400; margin-bottom:0.375rem;\">${String(zoneType)}</div>` : ''}
      ${generalized ? `<div style=\"text-align:center; font-size:0.8125rem; color:#4b5563; margin-bottom:0.25rem;\">${String(generalized)}</div>` : ''}
      ${acresText ? `<div style=\"text-align:center; font-size:0.8125rem; color:#4b5563; margin-bottom:0.25rem;\">${acresText}</div>` : ''}
      ${(county||city) ? `<div style=\"text-align:center; font-size:0.8125rem; color:#6b7280;\">${[city, county].filter(Boolean).join(', ')}</div>` : ''}
      ${moreInfo ? `<div style=\"text-align:center; margin-top:0.5rem;\"><a href=\"${moreInfo}\" target=\"_blank\" rel=\"noopener\" style=\"color:#2563eb; text-decoration:none; font-size:0.875rem;\">More Information &rarr;</a></div>` : ''}
    </div>
  `;

  if (MAP_PROVIDER === 'google') {
    // Google InfoWindow
    currentInfoWindow = new google.maps.InfoWindow({
      content: html,
      position: { lat: coordinate[1], lng: coordinate[0] },
    });
    currentInfoWindow.open({ map: map.value });
  } else {
    // Close any existing popup
    if (currentInfoWindow && currentInfoWindow.remove) {
      currentInfoWindow.remove();
    }
    // MapLibre popup
    const popup = new maplibregl.Popup({
      closeButton: true,
      maxWidth: '360px',
      offset: 15
    })
      .setLngLat([coordinate[0], coordinate[1]])
      .setHTML(html)
      .addTo(map.value);

    // Center the map on the popup with offset for better visibility
    try {
      const point = map.value.project([coordinate[0], coordinate[1]]);
      const offsetPoint = { x: point.x, y: point.y - 100 }; // Smaller offset for GP popup
      const newCenter = map.value.unproject(offsetPoint);
      map.value.easeTo({ center: [newCenter.lng, newCenter.lat], duration: 350 });
    } catch {}
    currentInfoWindow = popup as any;
  }
}

// Add parcel to Airtable (Land Database table)
async function addParcelToAirtable(parcel: ParcelRow) {
  try {
    // Step 1: Create/find the parcel in the Parcels table first
    let parcelRecordId: string | undefined;
    if (AIRTABLE_PARCELS_TABLE_ID && parcel.apn) {
      const apnToId = await upsertParcelsInAirtable([parcel]);
      parcelRecordId = apnToId.get(String(parcel.apn));
    }

    // Build mailing address string
    const mailingParts = [
      parcel.owner_address,
      parcel.city,
      'UT',
      parcel.zip_code
    ].filter(Boolean);
    const mailingAddress = mailingParts.join(', ');

    // Start with minimal required fields only
    // Use property address for Name, fallback to "Parcel {APN}" only if no address
    const payload = {
      fields: {
        'Name': parcel.address || `Parcel ${parcel.apn || 'Unknown'}`
      }
    };

    // Add optional fields (only works if they're text fields in Airtable, not dropdowns)
    const optionalFields: Record<string, any> = {
      'Property Address': parcel.address,
      'Size (acres)': parcel.size_acres,
      'ZIP': parcel.zip_code,
      'Owner Name': parcel.owner_name,
      'Mailing Address': mailingAddress,
      'City': parcel.city  // Only works if City is a text field, not dropdown
    };

    // Add the Parcel(s) link if we have the parcel record ID
    if (parcelRecordId) {
      optionalFields[AIRTABLE_LAND_PARCELS_LINK_FIELD] = [parcelRecordId];
    }

    // Only add fields that exist and have values
    for (const [key, value] of Object.entries(optionalFields)) {
      if (value) {
        (payload.fields as any)[key] = value;
      }
    }

    console.log('Sending to Airtable:', payload);

    // Use table ID instead of table name to avoid encoding issues
    console.log('Using table ID:', AIRTABLE_TABLE_ID);

    const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const responseData = await response.json();
    console.log('Airtable response:', responseData);

    if (!response.ok) {
      console.error('Airtable API error:', responseData);
      alert(`Failed to add to Airtable:\n\n${JSON.stringify(responseData, null, 2)}\n\nCheck console for full details.`);
      return false;
    }

    console.log('Added to Airtable:', responseData);

    // Build URL to open the newly created record in Airtable
    const recordId = responseData.id;
    const recordUrl = AIRTABLE_VIEW_ID
      ? `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${AIRTABLE_VIEW_ID}/${recordId}`
      : `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${recordId}`;

    // Open Airtable record in new tab
    window.open(recordUrl, '_blank');

    return true;
  } catch (error) {
    console.error('Failed to add to Airtable:', error);
    alert(`Failed to add to Airtable: ${error}\n\nCheck console for details.`);
    return false;
  }
}

//Add parcel to Airtable (LandOwner Database table)
async function addParcelToLandownerAirtable(parcel: ParcelRow) {
  try {
    // Build mailing address string
    const mailingParts = [
      parcel.owner_address,
      parcel.city,
      'UT',
      parcel.zip_code
    ].filter(Boolean);
    const mailingAddress = mailingParts.join(', ');

    const payload = {
      fields: {
        'Name': parcel.owner_name
      }
    };

    const optionalFields: Record<string, any> = {
      'Owner Address': mailingAddress,
      'City': parcel.city  // Only works if City is a text field, not dropdown
    };

    // Only add fields that exist and have values   
    for (const [key, value] of Object.entries(optionalFields)) {
      if (value) {
        (payload.fields as any)[key] = value;
      }
    }

    console.log('Sending to Airtable:', payload);

    const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_LANDOWNER_BASE}/${AIRTABLE_LANDOWNER_TABLE_ID}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const responseData = await response.json();
    console.log('Airtable response:', responseData);

    if (!response.ok) {
      console.error('Airtable API error:', responseData);
      alert(`Failed to add to Airtable:\n\n${JSON.stringify(responseData, null, 2)}\n\nCheck console for full details.`);
      return false;
    }

    console.log('Added to Airtable:', responseData);
    const recordId = responseData.id;

    const recordUrl = `https://airtable.com/${AIRTABLE_LANDOWNER_BASE}/${AIRTABLE_LANDOWNER_TABLE_ID}/${recordId}`

    // Open Airtable record in new tab
    window.open(recordUrl, '_blank');

    return true;
  } catch (error) {
    console.error('Failed to add to Airtable:', error);
    alert(`Failed to add to Airtable: ${error}\n\nCheck console for details.`);
    return false;
  }
}

// Load Google Maps API (only used when MAP_PROVIDER=google)
async function loadGoogleMaps(key: string, libraries: string[] = ['places']): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if ((window as any).google?.maps) return resolve();
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps-loader]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.dataset.googleMapsLoader = '1';
    const libs = libraries.length ? `&libraries=${libraries.join(',')}` : '';
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly${libs}`;
    s.async = true;
    s.defer = true; 
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
}

// Initialize Supabase client
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string
);

// Initialize map (Google or MapLibre based on MAP_PROVIDER)
async function ensureMap() {
  if (!mapEl.value) return;

  if (MAP_PROVIDER === 'google') {
    const key = import.meta.env.VITE_GOOGLE_MAPS_KEY as string;
    if (!key) {
      console.error('Missing VITE_GOOGLE_MAPS_KEY in .env');
      return;
    }
    try {
      await loadGoogleMaps(key);
      // It's possible that google.maps is still undefined immediately after loading.
      await new Promise(resolve => setTimeout(resolve, 50));
      map.value = new google.maps.Map(mapEl.value, {
        center: { lat: 39.3210, lng: -111.0937 }, // Center of Utah
        zoom: 7,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: true,
      });
      geocoder = new google.maps.Geocoder();
      await initializeDeckOverlay();
    } catch (error) {
      console.error('Failed to initialize Google Maps:', error);
    }
    return;
  }

  // MapLibre path (default when not google)
  try {
    // Define basemap styles
    const getBasemapStyle = (type: 'streets' | 'satellite') => {
      if (type === 'satellite') {
        return {
          version: 8,
          sources: {
            'esri-satellite': {
              type: 'raster',
              tiles: [
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
              ],
              tileSize: 256,
              attribution: 'Esri, Maxar, Earthstar Geographics, CNES/Airbus DS, USDA FSA, USGS, Aerogrid, IGN, IGP, and the GIS User Community'
            }
          },
          layers: [
            { id: 'satellite', type: 'raster', source: 'esri-satellite', minzoom: 0, maxzoom: 22 }
          ]
        };
      } else {
        return {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '? OpenStreetMap contributors'
            }
          },
          layers: [
            { id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }
          ]
        };
      }
    };

    // Basic OSM raster style if no custom style URL provided
    const style = BASEMAP_STYLE_URL || getBasemapStyle(basemapType.value) as any;

    map.value = new maplibregl.Map({
      container: mapEl.value,
      style,
      center: [-111.0937, 39.3210], // Center of Utah
      zoom: 7,
      attributionControl: { compact: true }
    });

    // Add basic navigation controls (helps users zoom to parcel visibility threshold)
    try {
      map.value.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    } catch {}

    // Gracefully handle styles missing sprite images (e.g., office_11)
    map.value.on('styleimagemissing', (e: any) => {
      const id = e?.id;
      if (!id || (map.value.hasImage && map.value.hasImage(id))) return;
      try {
        const data = new Uint8Array(4); // 1x1 transparent pixel
        map.value.addImage(id, { width: 1, height: 1, data }, { pixelRatio: 1 });
      } catch (err) {
        console.warn('styleimagemissing', id, err);
      }
    });

    await new Promise<void>(resolve => {
      map.value.once('load', () => resolve());
    });

    await initializeDeckOverlay();
    // Track user interaction to avoid late fitBounds snapping
    // Mark as interacted immediately on any user-initiated map movement
    map.value.on('movestart', (e: any) => {
      // Only mark as interacted if this is a user action (not programmatic)
      if (!e.originalEvent) return; // programmatic move
      userHasInteracted = true;
    });
    map.value.on('zoomstart', (e: any) => {
      // Only mark as interacted if this is a user action (not programmatic)
      if (!e.originalEvent) return; // programmatic zoom
      userHasInteracted = true;
    });
    map.value.on('dragstart', () => { userHasInteracted = true; });
    map.value.on('wheel', () => { userHasInteracted = true; });
    map.value.on('touchstart', () => { userHasInteracted = true; });
    // Render initial layers once map is ready
    await updateDeckLayers();
  } catch (err) {
    console.error('Failed to initialize MapLibre:', err);
  }
}

// Switch basemap (streets/satellite) for MapLibre
async function switchBasemap(type: 'streets' | 'satellite') {
  if (!map.value || MAP_PROVIDER === 'google') return;

  // Prevent rapid switching
  if (basemapType.value === type) return;

  basemapType.value = type;

  const newStyle = type === 'satellite'
    ? {
        version: 8,
        sources: {
          'esri-satellite': {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
            ],
            tileSize: 256,
            attribution: 'Esri, Maxar, Earthstar Geographics, CNES/Airbus DS, USDA FSA, USGS, Aerogrid, IGN, IGP, and the GIS User Community'
          }
        },
        layers: [
          { id: 'satellite', type: 'raster' as const, source: 'esri-satellite', minzoom: 0, maxzoom: 22 }
        ]
      }
    : {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '? OpenStreetMap contributors'
          }
        },
        layers: [
          { id: 'osm', type: 'raster' as const, source: 'osm', minzoom: 0, maxzoom: 19 }
        ]
      };

  try {
    // Remove old event listeners to prevent duplicates
    map.value.off('styledata', updateDeckLayers as any);

    // Set the new style
    map.value.setStyle(newStyle as any, { diff: false }); // diff: false forces full reload

    // Wait for style to be fully loaded before re-adding deck.gl layers
    const onStyleLoad = async () => {
      // Small delay to ensure style is fully ready
      await new Promise(resolve => setTimeout(resolve, 100));
      await updateDeckLayers();
    };

    map.value.once('style.load', onStyleLoad);
  } catch (err) {
    console.error('Failed to switch basemap:', err);
  }
}

// Initialize deck.gl overlay for GPU-accelerated parcel rendering
async function initializeDeckOverlay() {
  if (!map.value) return;

  if (MAP_PROVIDER === 'google') {
    // Google overlay
    deckOverlay = new GoogleMapsOverlay({ layers: [] });
    deckOverlay.setMap(map.value);
  } else {
    // MapLibre overlay
    deckOverlay = new MapboxOverlay({
      layers: [],
      interleaved: true
    });
    map.value.addControl(deckOverlay);
  }

  console.log('deck.gl overlay initialized for', MAP_PROVIDER);
  // Ensure deck.gl receives pointer events for clicks/selection
  setDeckPointerMode(true);
}

// On-click handler for both tile and GeoJSON layers
async function handlePick({ apn, coordinate, props }: { apn: string, coordinate: [number, number], props: any }) {
  if (!map.value || !apn) return;

  // Selection mode: toggle and skip popup
  if (selectionEnabled.value) {
    toggleSelect(apn);
    return;
  }

  // Immediately show info window with properties from the clicked feature (tile or GeoJSON)
  if (currentInfoWindow && MAP_PROVIDER === 'google') currentInfoWindow.close();

  // Fetch full, live details from Supabase using the new RPC function
  const { data: fullParcel, error } = await supabase.rpc('parcel_by_apn', { apn_in: apn });

  if (error) {
    console.error('Error fetching full parcel details:', error);
    // Even if the fetch fails, we can still show the basic info from the tile/feature
  }

  // Combine properties: start with tile/feature props, then overwrite with fresh data from DB
  const finalProps = { ...props, ...(fullParcel || {}) };

  // Create and show the InfoWindow
  const html = createStyledParcelInfoWindowHtml(finalProps as ParcelRow);
  if (MAP_PROVIDER === 'google') {
    currentInfoWindow = new google.maps.InfoWindow({
      content: html,
      position: { lat: coordinate[1], lng: coordinate[0] },
    });

    // Close popup when user clicks the X
    currentInfoWindow.addListener('closeclick', () => {
      currentInfoWindow = null;
    });

    // Center the map under the popup for better UX
    try { map.value.panTo({ lat: coordinate[1], lng: coordinate[0] }); } catch {}
    currentInfoWindow.open({ map: map.value });

    // Add event listeners for the buttons inside the InfoWindow
    google.maps.event.addListenerOnce(currentInfoWindow, 'domready', () => {
      const buttonId = `add-to-airtable-deck-${finalProps.id}`;
      const landownerButtonId = `add-to-landowner-airtable-deck-${finalProps.id}`;
      const selectBtnId = `toggle-select-${finalProps.id}`;
      
      const button = document.getElementById(buttonId);
      if (button) {
        button.addEventListener('click', () => addParcelToAirtable(finalProps as ParcelRow));
      }

      const landownerButton = document.getElementById(landownerButtonId);
      if (landownerButton) {
        landownerButton.addEventListener('click', () => addParcelToLandownerAirtable(finalProps as ParcelRow));
      }
      const selectBtn = document.getElementById(selectBtnId) as HTMLButtonElement | null;
      if (selectBtn) {
        selectBtn.addEventListener('click', () => {
          toggleSelect(finalProps.apn);
          const nowSelected = isSelected(finalProps.apn);
          selectBtn.textContent = nowSelected ? 'Unmark Parcel' : 'Mark Parcel';
        });
      }
      const toggleId = `toggle-details-${finalProps.id}`;
      const detailsId = `details-${finalProps.id}`;
      const toggleEl = document.getElementById(toggleId) as HTMLAnchorElement | null;
      if (toggleEl) {
        toggleEl.addEventListener('click', (e) => {
          e.preventDefault();
          const d = document.getElementById(detailsId) as HTMLDivElement | null;
          if (d) {
            const show = d.style.display !== 'none';
            d.style.display = show ? 'none' : 'block';
            toggleEl.textContent = show ? "Show More Details" : "Hide Details";
          }
        });
      }
    });
  } else {
    // Close any existing popup
    if (currentInfoWindow && currentInfoWindow.remove) {
      currentInfoWindow.remove();
    }

    const popup = new maplibregl.Popup({
      closeButton: true,
      maxWidth: '360px',
      offset: 25 // Add offset so popup doesn't cover the parcel
    })
      .setLngLat([coordinate[0], coordinate[1]])
      .setHTML(html)
      .addTo(map.value);

    // Center the map on the popup location with slight upward offset for better visibility
    try {
      const point = map.value.project([coordinate[0], coordinate[1]]);
      const offsetPoint = { x: point.x, y: point.y - 150 }; // Move view down so popup is centered
      const newCenter = map.value.unproject(offsetPoint);
      map.value.easeTo({ center: [newCenter.lng, newCenter.lat], duration: 350 });
    } catch {}
    currentInfoWindow = popup as any;

    // Attach DOM listeners after popup is added to DOM
    // MapLibre adds popup content synchronously, so we can attach listeners immediately after addTo()
    setTimeout(() => {
      const buttonId = `add-to-airtable-deck-${finalProps.id}`;
      const landownerButtonId = `add-to-landowner-airtable-deck-${finalProps.id}`;
      const selectBtnId = `toggle-select-${finalProps.id}`;

      const button = document.getElementById(buttonId);
      if (button) {
        button.addEventListener('click', () => addParcelToAirtable(finalProps as ParcelRow));
      }
      const landownerButton = document.getElementById(landownerButtonId);
      if (landownerButton) {
        landownerButton.addEventListener('click', () => addParcelToLandownerAirtable(finalProps as ParcelRow));
      }
      const selectBtn = document.getElementById(selectBtnId) as HTMLButtonElement | null;
      if (selectBtn) {
        selectBtn.addEventListener('click', () => {
          toggleSelect(finalProps.apn);
          const nowSelected = isSelected(finalProps.apn);
          selectBtn.textContent = nowSelected ? 'Unmark Parcel' : 'Mark Parcel';
        });
      }
      const toggleId = `toggle-details-${finalProps.id}`;
      const detailsId = `details-${finalProps.id}`;
      const toggleEl = document.getElementById(toggleId) as HTMLAnchorElement | null;
      if (toggleEl) {
        toggleEl.addEventListener('click', (e) => {
          e.preventDefault();
          const d = document.getElementById(detailsId) as HTMLDivElement | null;
          if (d) {
            const show = d.style.display !== 'none';
            d.style.display = show ? 'none' : 'block';
            toggleEl.textContent = show ? "Show More Details" : "Hide Details";
          }
        });
      }
    }, 0);
  }
}

// Build HTML content for parcel info window (deck.gl click)
function createStyledParcelInfoWindowHtml(p: ParcelRow): string {
  const title = (p.address || '').toString().toUpperCase() || (p.apn ? `PARCEL ${p.apn}` : 'PARCEL');
  const idSafe = p.id ?? 'x';
  const countyText = (p.county || '').toString() + ' County';
  const sizeText = p.size_acres != null ? `${Number(p.size_acres).toFixed(2)} acres` : '&mdash;';
  const apnText = p.apn || '&mdash;';
  const markLabel = isSelected(p.apn || null) ? 'Unmark Parcel' : 'Mark Parcel';
  const selectBtnId = `toggle-select-${idSafe}`;
  const ownerName = (p.owner_name || '').toString().toUpperCase();
  const ownerAddr1 = (p.owner_address || '').toString();
  const ownerAddr2 = [p.city, p.zip_code].filter(Boolean).join(', ');
  const airtableBtnId = `add-to-airtable-deck-${idSafe}`;
  const landownerBtnId = `add-to-landowner-airtable-deck-${idSafe}`;
  const viewLink = p.property_url
    ? `<a href="${p.property_url}" target="_blank" rel="noopener" style="color:#2563eb; text-decoration:none; font-size:0.875rem;">View on Utah Parcels &rarr;</a>`
    : '';
  const countySearch = countyText
    ? `<a href="https://www.google.com/search?q=${encodeURIComponent(countyText + ' parcel search ' + (p.apn||''))}" target="_blank" rel="noopener" style="color:#6b7280; text-decoration:none; font-size:0.875rem;">Search ${countyText} &rarr;</a>`
    : '';
  return `
    <div class="cw-popup" style="width:22rem; max-width:90vw; color:#111827; padding:0.75rem; box-sizing:border-box; margin:0 auto;">
      <div style="font-size:0.6875rem; color:#2563eb; text-transform:uppercase; letter-spacing:0.05rem; margin-bottom:0.5rem;">
        <svg width="10" height="10" viewBox="0 0 12 12" style="display:inline-block; vertical-align:middle; margin-right:0.25rem; margin-bottom:0.125rem;"><path d="M6 0 L12 6 L6 12 L0 6 Z" fill="#2563eb"/></svg>
        <span style="color:#2563eb;">${countyText.toUpperCase()} PARCEL</span>
      </div>
      <div style="font-size:1.25rem; letter-spacing:-0.01rem; line-height:1.2; margin-bottom:0.25rem; word-wrap:break-word;">${title}</div>
      <div style="font-size:0.875rem; color:#6b7280; margin-bottom:0.75rem;">${countyText}</div>
      <div style="background:#f3f4f6; border-radius:6px; padding:0.75rem; margin-bottom:0.75rem;">
        <div style="font-size:0.625rem; color:#6b7280; letter-spacing:0.05rem; margin-bottom:0.5rem;">OWNER INFORMATION</div>
        ${ownerName ? `<div style="font-size:0.875rem; margin-bottom:0.25rem; color:#111827; line-height:1.3; word-wrap:break-word;">${ownerName}</div>` : ''}
        ${ownerAddr1 ? `<div style="font-size:0.8125rem; color:#6b7280; line-height:1.3; word-wrap:break-word;">${ownerAddr1}</div>` : ''}
        ${ownerAddr2 ? `<div style="font-size:0.8125rem; color:#6b7280; line-height:1.3; word-wrap:break-word;">${ownerAddr2}</div>` : ''}
      </div>
      <div style="margin-bottom:0.75rem; font-size:0.875rem;">
        <div style="color:#6b7280; margin-bottom:0.25rem;">APN: <span style="color:#111827; font-weight:400;">${apnText}</span></div>
        <div style="color:#6b7280;">Size: <span style="color:#111827; font-weight:400;">${sizeText}</span></div>
      </div>
      <div style="display:flex; flex-direction:column; gap:0.5rem; margin-bottom:0.75rem;">
        <button id="${airtableBtnId}" style="background:#000; color:#fff; border:none; border-radius:6px; padding:0.625rem 0.75rem; cursor:pointer; font-size:0.8125rem; width:100%; box-sizing:border-box;"><span style="color:#a78bfa; margin-right:0.375rem;">+</span>Add Parcel to Land Database</button>
        <button id="${landownerBtnId}" style="background:#000; color:#fff; border:none; border-radius:6px; padding:0.625rem 0.75rem; cursor:pointer; font-size:0.8125rem; width:100%; box-sizing:border-box;"><span style="color:#a78bfa; margin-right:0.375rem;">+</span>Add Owner to Landowner Database</button>
        <button id="${selectBtnId}" style="background:#f9fafb; color:#111827; border:1px solid #e5e7eb; border-radius:6px; padding:0.625rem 0.75rem; cursor:pointer; font-size:0.8125rem; width:100%; box-sizing:border-box;">${markLabel}</button>
      </div>
      ${(viewLink || countySearch) ? `<div style="display:flex; flex-direction:column; gap:0.375rem; padding-top:0.5rem; border-top:1px solid #e5e7eb; font-size:0.8125rem;">${viewLink ? `<div>${viewLink}</div>` : ''}${countySearch ? `<div>${countySearch}</div>` : ''}</div>` : ''}
      <div style="padding-top:0.5rem; border-top:1px solid #e5e7eb; margin-top:0.5rem;">
        <a id="toggle-details-${idSafe}" href="#" style="color:#2563eb; text-decoration:none; font-size:0.8125rem;">
          Show More Details
        </a>
        <div id="details-${idSafe}" style="display:none; margin-top:0.5rem; max-height:300px; overflow:auto; border:1px solid #e5e7eb; border-radius:6px; padding:0.25rem;">
          ${(() => {
            try {
              const obj: any = p as any;
              const entries = Object.entries(obj).filter(([k, v]) => v !== null && v !== undefined && k !== 'geojson' && k !== 'geom');
              const safe = (s: any) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              const rows = entries.map(([k, v]) => `
                <tr>
                  <td style="padding:0.125rem 0.25rem; color:#6b7280; width:28%; vertical-align:top; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safe(k)}</td>
                  <td style="padding:0.125rem 0.25rem; color:#111827; word-break:break-word; overflow-wrap:anywhere;">${safe(typeof v === 'object' ? JSON.stringify(v) : v)}</td>
                </tr>
              `).join('');
              return `<table style="width:100%; table-layout:fixed; border-collapse:collapse; font-size:0.75rem;">${rows}</table>`;
            } catch {
              return '<div style="color:#9ca3af; font-size:0.8rem;">No details available</div>';
            }
          })()}
        </div>
      </div>
    </div>`;
}

function createParcelsTileLayer() {
  // Check if using Supabase Edge Function or RPC endpoint for tiles
  const isSupabaseTiles = PARCELS_TILES_URL.includes('/functions/v1/parcels-tile') ||
                          PARCELS_TILES_URL.includes('/rpc/parcels_tile');

  const flipY = String(import.meta.env.VITE_PARCELS_TILES_FLIP_Y || 'false').toLowerCase() === 'true';

  const layerConfig: any = {
    id: 'parcels-tiles',
    data: ({x, y, z}: any) => {
      try {
        const yy = flipY ? (Math.pow(2, z) - 1 - y) : y;
        return PARCELS_TILES_URL
          .replace('{z}', String(z))
          .replace('{x}', String(x))
          .replace('{y}', String(yy));
      } catch {
        return PARCELS_TILES_URL;
      }
    },
    loaders: [MVTLoader],
    pickable: true,
    filled: true,
    stroked: true,
    getFillColor: (f: any) => isSelected(f?.properties?.apn) ? [37, 99, 235, 180] : [37, 99, 235, 96],
    getLineColor: (f: any) => isSelected(f?.properties?.apn) ? [0, 0, 0, 255] : [30, 64, 175, 255],
    lineWidthMinPixels: 1.5,
    // Clamp requests to configured zoom window
    minZoom: Math.max(0, Number(PARCELS_TILES_MIN_ZOOM) || 0),
    maxZoom: Math.max(0, Number(PARCELS_GEOJSON_MIN_ZOOM) ? Number(PARCELS_GEOJSON_MIN_ZOOM) - 1 : 24),
    maxRequests: 6,
    refinementStrategy: 'no-overlap',
    uniqueIdProperty: 'id',
    // Prevent layer from affecting viewport
    autoHighlight: false,
    highlightColor: [255, 255, 255, 0],
    updateTriggers: {
      getFillColor: [() => selectedVersion.value],
      getLineColor: [() => selectedVersion.value],
    },
    onClick: (info: any) => {
      if (!info?.object) return;
      const apn = info.object.properties?.apn;
      if (apn) {
        handlePick({ apn, coordinate: info.coordinate, props: info.object.properties });
      }
    },
    onTileLoad: (tile: any) => {
      try {
        const idx = tile?.index || {};
        const c = tile?.content || tile?.data;
        const isEmpty = !c || (Array.isArray(c) && c.length === 0) || (c.byteLength === 0) || (typeof c === 'object' && Object.keys(c).length === 0);
        if (isEmpty) {
          console.warn('Parcels tile loaded but empty content at z/x/y:', idx.z, idx.x, idx.y);
        }
      } catch {}
    },
    onTileError: (err: any) => {
      // Silently handle tile errors to prevent viewport changes
      console.warn('Tile load error (expected for zoom < 13):', err);
    }
  };

  // Always include auth headers for Edge Function tiles; harmless if function is public
  if (isSupabaseTiles) {
    const authHeaders = {
      'apikey': String(import.meta.env.VITE_SUPABASE_ANON_KEY || ''),
      'Authorization': `Bearer ${String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')}`,
    };
    layerConfig.loadOptions = {
      ...(layerConfig.loadOptions || {}),
      // Force headers on every tile request across loaders.gl versions
      fetch: (url: any, options: any) => {
        const merged = {
          ...(options || {}),
          headers: { ...(options?.headers || {}), ...authHeaders },
        };
        return fetch(url, merged as any);
      },
      mvt: { shape: 'binary' }
    } as any;
  } else {
    layerConfig.loadOptions = { ...(layerConfig.loadOptions || {}), mvt: { shape: 'binary' } } as any;
  }

  return new MVTLayer(layerConfig);
}

// Update deck.gl layers with parcel data
async function updateDeckLayers() {
  if (!deckOverlay || !map.value) {
    return;
  }

  // If all layers are disabled (and counties optionally), clear layers
  if (!showParcels.value && !showGeneralPlan.value && !showLaytonGeneralPlan.value && !showLaytonZoning.value && !showCounties.value) {
    deckOverlay.setProps({ layers: [] });
    return;
  }

  // Decide parcels rendering mode by zoom
  const zoom = (typeof map.value.getZoom === 'function') ? map.value.getZoom() || 0 : 0;
  const MIN_PARCEL_ZOOM = PARCELS_TILES_MIN_ZOOM;
  const LIVE_GEOJSON_ZOOM = PARCELS_GEOJSON_MIN_ZOOM;
  const useTiles = showParcels.value && zoom >= MIN_PARCEL_ZOOM && zoom < LIVE_GEOJSON_ZOOM;
  const useLive = showParcels.value && zoom >= LIVE_GEOJSON_ZOOM;
  if (showLaytonGeneralPlan.value && zoom > LAYTON_GP_TILES_MAX_ZOOM) {
    console.info(`Layton GP tiles max zoom is ${LAYTON_GP_TILES_MAX_ZOOM}. You are at z=${zoom.toFixed(1)}; tiles may 400 beyond their max. Consider increasing VITE_LAYTON_GP_TILES_MAX_ZOOM to keep the layer visible at higher zooms.`);
  }

  if (zoom < MIN_PARCEL_ZOOM && !useTiles && !useLive) {
    console.log(`Zoom level ${zoom.toFixed(1)} too low. Zoom to ${MIN_PARCEL_ZOOM}+ to see parcels.`);
    const layersLow: any[] = [];
    // Counties layer (MapLibre path via deck.gl)
    if (MAP_PROVIDER !== 'google' && showCounties.value) {
      const countiesLayer = await createCountiesLayer();
      if (Array.isArray(countiesLayer)) layersLow.push(...countiesLayer); else if (countiesLayer) layersLow.push(countiesLayer);
    }
    if (showGeneralPlan.value) {
      const gp = createGeneralPlanLayer();
      if (gp) layersLow.push(gp);
    }
    if (showLaytonGeneralPlan.value) {
      const lay = createLaytonGeneralPlanLayer();
      if (lay) layersLow.push(lay);
    }
    if (LAYTON_ZONING_ENABLED && showLaytonZoning.value) {
      await fetchLaytonZoning();
      const lay = createLaytonZoningLayer();
      if (lay) layersLow.push(lay);
    }
    // Add Layton overlay layers
    const overlays = createLaytonOverlayLayers();
    layersLow.push(...overlays);

    // Add search results layer on top
    const searchLayer = createSearchResultsLayer();
    if (searchLayer) layersLow.push(searchLayer);

    deckOverlay.setProps({ layers: layersLow });
    return;
  }

  // Fast path: tiles for mid-zooms
  if (useTiles) {
    console.log(`? Using tiles at zoom ${zoom.toFixed(1)}`);
    const layers: any[] = [];
    if (MAP_PROVIDER !== 'google' && showCounties.value) {
      const countiesLayer = await createCountiesLayer();
      if (Array.isArray(countiesLayer)) layers.push(...countiesLayer); else if (countiesLayer) layers.push(countiesLayer);
    }
    if (showGeneralPlan.value) {
      const gp = createGeneralPlanLayer();
      if (gp) layers.push(gp);
    }
    if (showLaytonGeneralPlan.value) {
      const lay = createLaytonGeneralPlanLayer();
      if (lay) layers.push(lay);
    }
    if (LAYTON_ZONING_ENABLED && showLaytonZoning.value) {
      await fetchLaytonZoning();
      const lay = createLaytonZoningLayer();
      if (lay) layers.push(lay);
    }
    // Parcels above GP layers for clickability
    if (showParcels.value) layers.push(createParcelsTileLayer());
    // Add Layton overlay layers
    const overlays = createLaytonOverlayLayers();
    layers.push(...overlays);

    // Add search results layer on top
    const searchLayer = createSearchResultsLayer();
    if (searchLayer) layers.push(searchLayer);

    console.log(`Setting ${layers.length} layers on deck.gl`);
    deckOverlay.setProps({ layers });
    return;
  }

  // If not using live yet and parcels are enabled, render tiles + GP and return
  if (showParcels.value && !useLive) {
    const layers: any[] = [];
    if (MAP_PROVIDER !== 'google' && showCounties.value) {
      const countiesLayer = await createCountiesLayer();
      if (Array.isArray(countiesLayer)) layers.push(...countiesLayer); else if (countiesLayer) layers.push(countiesLayer);
    }
    if (showGeneralPlan.value) {
      const gp = createGeneralPlanLayer();
      if (gp) layers.push(gp);
    }
    if (showLaytonGeneralPlan.value) {
      const lay = createLaytonGeneralPlanLayer();
      if (lay) layers.push(lay);
    }
    if (LAYTON_ZONING_ENABLED && showLaytonZoning.value) {
      await fetchLaytonZoning();
      const lay = createLaytonZoningLayer();
      if (lay) layers.push(lay);
    }
    // Parcels above GP layers for clickability
    layers.push(createParcelsTileLayer());
    // Add Layton overlay layers
    const overlays = createLaytonOverlayLayers();
    layers.push(...overlays);

    // Add search results layer on top
    const searchLayer = createSearchResultsLayer();
    if (searchLayer) layers.push(searchLayer);

    deckOverlay.setProps({ layers });
    return;
  }

  // Fetch live GeoJSON data from Supabase
  console.log(`Zoom ${zoom.toFixed(1)}: Fetching live GeoJSON data for entire viewport`);

  // Get current map bounds
  const bounds = map.value.getBounds && map.value.getBounds();
  if (!bounds) return;

  // Normalize bounds for both providers
  const ne = typeof bounds.getNorthEast === 'function' ? bounds.getNorthEast() : bounds.getNorthEast;
  const sw = typeof bounds.getSouthWest === 'function' ? bounds.getSouthWest() : bounds.getSouthWest;
  const neLng = typeof ne.lng === 'function' ? ne.lng() : ne.lng;
  const neLat = typeof ne.lat === 'function' ? ne.lat() : ne.lat;
  const swLng = typeof sw.lng === 'function' ? sw.lng() : sw.lng;
  const swLat = typeof sw.lat === 'function' ? sw.lat() : sw.lat;

  // If parcels are disabled, but GP is enabled, render GP only
  if (!showParcels.value) {
    const onlyGp: any[] = [];
    if (MAP_PROVIDER !== 'google' && showCounties.value) {
      const countiesLayer = await createCountiesLayer();
      if (Array.isArray(countiesLayer)) onlyGp.push(...countiesLayer); else if (countiesLayer) onlyGp.push(countiesLayer);
    }
    if (showGeneralPlan.value) {
      const gp = createGeneralPlanLayer();
      if (gp) onlyGp.push(gp);
    }
    if (showLaytonGeneralPlan.value) {
      const lay = createLaytonGeneralPlanLayer();
      if (lay) onlyGp.push(lay);
    }
    if (LAYTON_ZONING_ENABLED && showLaytonZoning.value) {
      await fetchLaytonZoning();
      const lay = createLaytonZoningLayer();
      if (lay) onlyGp.push(lay);
    }
    // Add Layton overlay layers
    const overlays = createLaytonOverlayLayers();
    onlyGp.push(...overlays);

    // Add search results layer on top
    const searchLayer = createSearchResultsLayer();
    if (searchLayer) onlyGp.push(searchLayer);

    deckOverlay.setProps({ layers: onlyGp });
    return;
  }

  try {
    // Call the parcels_in_bounds function using WKT bbox (existing RPC)
    const bbox = `POLYGON((${swLng} ${swLat}, ${neLng} ${swLat}, ${neLng} ${neLat}, ${swLng} ${neLat}, ${swLng} ${swLat}))`;

    // Check cache first
    const now = Date.now();
    if (parcelCache && parcelCache.bounds === bbox && (now - parcelCache.timestamp) < PARCEL_CACHE_TTL) {
      console.log('? Using cached parcel data');
      const data = parcelCache.data;

      // Continue with cached data (skip to feature conversion)
      const features = (data || []).map((parcel: any) => {
        const geom = typeof parcel.geom === 'string' ? JSON.parse(parcel.geom) : parcel.geom;
        return {
          type: 'Feature',
          geometry: geom,
          properties: {
            id: parcel.id,
            apn: parcel.apn,
            address: parcel.address,
            city: parcel.city,
          }
        };
      });

      const geojson = { type: 'FeatureCollection' as const, features };
      const parcelLayer = new GeoJsonLayer({
        id: 'parcels-layer',
        data: geojson as any,
        pickable: true,
        stroked: true,
        filled: true,
        getFillColor: (f: any) => isSelected(f?.properties?.apn) ? [37, 99, 235, 140] : [37, 99, 235, 64],
        getLineColor: (f: any) => isSelected(f?.properties?.apn) ? [0, 0, 0, 220] : [30, 64, 175, 255],
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        getFeatureId: (f: any) => f.properties?.id,
        updateTriggers: {
          getFillColor: [() => selectedVersion.value],
          getLineColor: [() => selectedVersion.value],
        },
        onClick: (info: any) => {
          if (!info?.object) return;
          const { apn } = info.object.properties;
          handlePick({ apn, coordinate: info.coordinate, props: info.object.properties });
        }
      });

      const layersToSet: any[] = [];
      if (MAP_PROVIDER !== 'google' && showCounties.value) {
        const countiesLayer = await createCountiesLayer();
        if (Array.isArray(countiesLayer)) layersToSet.push(...countiesLayer); else if (countiesLayer) layersToSet.push(countiesLayer);
      }
      if (showGeneralPlan.value) {
        const gp = createGeneralPlanLayer();
        if (gp) layersToSet.push(gp);
      }
      if (showLaytonGeneralPlan.value) {
        const lay = createLaytonGeneralPlanLayer();
        if (lay) layersToSet.push(lay);
      }
      // Parcels drawn above GP layers
      layersToSet.push(parcelLayer);
      // Add Layton overlay layers
      const overlays = createLaytonOverlayLayers();
      layersToSet.push(...overlays);

      // Add search results layer on top
      const searchLayer = createSearchResultsLayer();
      if (searchLayer) layersToSet.push(searchLayer);

      deckOverlay.setProps({ layers: layersToSet });
      return;
    }

    console.log('Fetching parcels from Supabase for deck.gl...');
    const startTime = performance.now();

    // Use .limit() to get more parcels (Supabase default is 1000)
    // Optimize limit based on zoom level - fewer parcels at lower zooms
    const limit = zoom > 16 ? 3000 : zoom > 14 ? 2000 : 1000;
    const { data, error } = await supabase
      .rpc('parcels_in_bounds', { bbox_wkt: bbox })
      .limit(limit); // Dynamic limit based on zoom for better performance

    if (error) {
      console.error('Error fetching parcels:', error);
      return;
    }

    // Cache the result
    parcelCache = { bounds: bbox, data, timestamp: now };

    const endTime = performance.now();
    console.log(`? Fetched ${data?.length || 0} parcels in ${Math.round(endTime - startTime)}ms`);

    // Convert to GeoJSON FeatureCollection
    const features = (data || []).map((parcel: any) => {
      const geom = typeof parcel.geom === 'string' ? JSON.parse(parcel.geom) : parcel.geom;

      return {
        type: 'Feature',
        geometry: geom,
        properties: {
          id: parcel.id,
          apn: parcel.apn,
          address: parcel.address,
          city: parcel.city,
          county: parcel.county,
          zip_code: parcel.zip_code,
          owner_type: parcel.owner_type,
          size_acres: parcel.size_acres,
          property_url: parcel.property_url
        }
      };
    });

    const geojson = {
      type: 'FeatureCollection' as const,
      features
    };

  const parcelLayer = new GeoJsonLayer({
      id: 'parcels-layer',
      data: geojson as any,
      pickable: true,
      stroked: true,
      filled: true,
      getFillColor: (f: any) => isSelected(f?.properties?.apn) ? [37, 99, 235, 140] : [37, 99, 235, 64],
      getLineColor: (f: any) => isSelected(f?.properties?.apn) ? [0, 0, 0, 220] : [30, 64, 175, 255],
      getLineWidth: 2,
      lineWidthUnits: 'pixels', // Use 'pixels' for consistent line width
      getFeatureId: (f: any) => f.properties?.id,
      updateTriggers: {
        getFillColor: [() => selectedVersion.value],
        getLineColor: [() => selectedVersion.value],
      },
      onClick: (info: any) => {
        if (!info?.object) return;
        const { apn } = info.object.properties;
        handlePick({ apn, coordinate: info.coordinate, props: info.object.properties });
      }
    });

    // Update overlay with parcels + optional layers
    const layersToSet: any[] = [];
    if (MAP_PROVIDER !== 'google' && showCounties.value) {
      const countiesLayer = await createCountiesLayer();
      if (Array.isArray(countiesLayer)) layersToSet.push(...countiesLayer); else if (countiesLayer) layersToSet.push(countiesLayer);
    }
    if (showGeneralPlan.value) {
      const gp = createGeneralPlanLayer();
      if (gp) layersToSet.push(gp);
    }
    if (showLaytonGeneralPlan.value) {
      const lay = createLaytonGeneralPlanLayer();
      if (lay) layersToSet.push(lay);
    }
    // Parcels drawn above GP layers
    layersToSet.push(parcelLayer);
    // Add Layton overlay layers
    const overlays = createLaytonOverlayLayers();
    layersToSet.push(...overlays);

    // Add search results layer on top (highest priority)
    const searchLayer = createSearchResultsLayer();
    if (searchLayer) layersToSet.push(searchLayer);

    deckOverlay.setProps({ layers: layersToSet });

  } catch (error) {
    console.error('Failed to update deck.gl GeoJSON layer:', error);
  }
}

// Clear all markers and polygons
function clearMarkers() {
  for (const m of markers) {
    if (MAP_PROVIDER === 'google' && m.setMap) {
      m.setMap(null);
    } else if (MAP_PROVIDER !== 'google' && m.remove) {
      m.remove();
    }
  }
  markers.length = 0;
  Object.keys(markersById).forEach(k => delete markersById[k]);
  Object.keys(infoWindowsById).forEach(k => delete infoWindowsById[k]);
}

function clearPolygons() {
  for (const p of polygons) p.setMap(null);
  polygons.length = 0;
  // Clear the APN tracking object
  for (const key in polygonsByApn) {
    delete polygonsByApn[key];
  }
}

// Geocode address (Google when available, otherwise Nominatim)
function normalizeAddress(addr: string): string {
  return String(addr || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,\s*,/g, ', ')
    .toUpperCase();
}

async function geocodeOne(addr: string): Promise<{ lat: number; lng: number } | null> {
  if (cache.has(addr)) return cache.get(addr)!;
  const key = normalizeAddress(addr);

  if (MAP_PROVIDER === 'google') {
    // 1) Try Supabase cache first
    try {
      const { supabase } = await import('../lib/supabase');
      const { data: gcached } = await supabase
        .from('geocodes')
        .select('lat,lng')
        .eq('address', key)
        .maybeSingle();
      if (gcached && isValidLatLng(gcached as any)) {
        const p = { lat: Number((gcached as any).lat), lng: Number((gcached as any).lng) };
        cache.set(addr, p);
        return p;
      }
    } catch {}

    if (!geocoder) return null;
    try {
      const result = await new Promise<google.maps.GeocoderResult[] | null>((resolve) => {
        geocoder!.geocode({ address: addr }, (results, status) => {
          if (status === google.maps.GeocoderStatus.OK && results && results.length) {
            resolve(results);
          } else {
            resolve(null);
          }
        });
      });
      const loc = result?.[0]?.geometry?.location;
      if (loc) {
        const p = { lat: loc.lat(), lng: loc.lng() };
        cache.set(addr, p);
        // 2) Persist to Supabase cache table for next time
        try {
          const { supabase } = await import('../lib/supabase');
          await supabase
            .from('geocodes')
            .upsert({ address: key, lat: p.lat, lng: p.lng }, { onConflict: 'address' });
        } catch {}
        return p;
      }
    } catch (e) {
      console.warn('Geocode failed for', addr, e);
    }
    return null;
  }

  // MapTiler Geocoding (default for non-Google) with small concurrency and retry
  const maptilerFetch = async () => withGeocodeSlot(async () => {
    if (!MAPTILER_KEY) return null;
    const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(addr)}.json`);
    url.searchParams.set('key', MAPTILER_KEY);
    url.searchParams.set('limit', '1');
    url.searchParams.set('language', 'en');
    url.searchParams.set('autocomplete', 'false');
    url.searchParams.set('country', 'us');
    const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const feat = json && json.features && json.features[0];
    const center = feat && feat.center;
    if (!center || center.length < 2) return null;
    const p = { lat: Number(center[1]), lng: Number(center[0]) };
    if (!isValidLatLng(p)) return null;
    cache.set(addr, p);
    return p;
  });

  const nominatimFetch = async () => withGeocodeSlot(async () => {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('q', addr);
    url.searchParams.set('limit', '1');
    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json', 'Accept-Language': 'en', 'User-Agent': 'in-house-gis-app/1.0' }
    });
    if (!res.ok) return null;
    const arr = await res.json();
    const first = Array.isArray(arr) && arr[0];
    if (!first || !first.lat || !first.lon) return null;
    const p = { lat: Number(first.lat), lng: Number(first.lon) };
    if (!isValidLatLng(p)) return null;
    cache.set(addr, p);
    return p;
  });

  try {
    if (GEOCODER === 'maptiler' && MAPTILER_KEY) {
      const p1 = await maptilerFetch();
      if (p1) return p1;
      await new Promise(r => setTimeout(r, 300));
      const p2 = await maptilerFetch();
      if (p2) return p2;
    }
    // fallback to Nominatim
    const p3 = await nominatimFetch();
    if (p3) return p3;
    await new Promise(r => setTimeout(r, 300));
    const p4 = await nominatimFetch();
    if (p4) return p4;
  } catch (e) {
    console.warn('Geocode error for', addr, e);
  }
  return null;
}

// Fetch parcels from Supabase with viewport filtering
async function fetchParcels(bounds?: google.maps.LatLngBounds): Promise<ParcelRow[]> {
  if (!showParcels.value) {
    console.log('Parcel layer is disabled');
    return [];
  }

  // Check zoom level - only show parcels when zoomed in enough
  const zoom = map.value?.getZoom() || 0;
  const MIN_ZOOM = 14; // Adjust this value (higher = need to zoom in more)

  if (zoom < MIN_ZOOM) {
    console.log(`Gï¿½ï¿½n+ï¿½ Zoom level ${zoom} too low. Zoom to ${MIN_ZOOM}+ to see parcels.`);
    return [];
  }

  try {
    const { fetchParcelsInBounds, fetchAllParcels } = await import('../lib/supabase');

    console.log('Fetching parcels from Supabase...');
    const startTime = performance.now();

    let parcels;

    // If we have bounds, use spatial filtering
    if (bounds) {
      console.log('Using viewport bounds to filter parcels...');
      parcels = await fetchParcelsInBounds(bounds);
    } else {
      // Fallback to all parcels (shouldn't happen often)
      console.log('No bounds available, fetching all parcels...');
      parcels = await fetchAllParcels(10000);
    }

    const endTime = performance.now();
    console.log(`Gï¿½ï¿½ Fetched ${parcels.length} parcels from Supabase in ${Math.round(endTime - startTime)}ms`);

    // Transform Supabase data to match our ParcelRow format
    return parcels.map(p => {
      // Parse the PostGIS geometry back to GeoJSON
      // Supabase returns geometry as GeoJSON object
      const geojson = p.geom ? (typeof p.geom === 'string' ? JSON.parse(p.geom) : p.geom) : null;

      return {
        id: p.id,
        apn: p.apn,
        address: p.address || null,
        city: p.city || null,
        zip_code: p.zip_code || null,
        county: p.county || 'Davis',
        owner_type: null,
        owner_name: p.owner_name || null,
        owner_address: p.owner_address || null,
        size_acres: p.size_acres || null,
        property_value: p.property_value || null,
        subdivision: p.subdivision || null,
        year_built: p.year_built || null,
        sqft: p.sqft || null,
        property_url: p.property_url || 'https://webportal.daviscountyutah.gov/App/PropertySearch/esri/map',
        geojson: geojson
      };
    }).filter(row => row.geojson != null);
  } catch (error) {
    console.error('Failed to fetch parcels from Supabase:', error);
    return [];
  }
}

// Calculate centroid of polygon for label placement
function calculateCentroid(paths: google.maps.LatLngLiteral[][]): google.maps.LatLngLiteral {
  // Use the first ring (outer boundary)
  const ring = paths[0];
  if (!ring || ring.length === 0) return { lat: 0, lng: 0 };

  let latSum = 0;
  let lngSum = 0;

  for (const point of ring) {
    latSum += point.lat;
    lngSum += point.lng;
  }

  return {
    lat: latSum / ring.length,
    lng: lngSum / ring.length
  };
}

// Clear county boundary polygons and labels
function clearCountyPolygons() {
  for (const p of countyPolygons) p.setMap(null);
  countyPolygons.length = 0;
  for (const label of countyLabels) { 
    (label as any).setMap(null); // OverlayView has setMap method
  }
  countyLabels.length = 0;
}

// Display county boundaries on map from Supabase
async function displayCountyBoundaries() {
  if (!map.value || !showCounties.value) return;
  if (MAP_PROVIDER !== 'google') {
    // On MapLibre we render county boundaries via deck.gl in updateDeckLayers()
    await updateDeckLayers();
    return;
  }

  clearCountyPolygons();

  try {
    const { fetchCounties } = await import('../lib/supabase');
    const counties = await fetchCounties();
    console.log(`Displaying ${counties.length} county boundaries from Supabase`);

    for (const county of counties) {
      const geojson = county.geom ? (typeof county.geom === 'string' ? JSON.parse(county.geom) : county.geom) : null;
      if (!geojson) continue;

      // Convert GeoJSON coordinates to Google Maps paths
      let paths: google.maps.LatLngLiteral[][] = [];

      if (geojson.type === 'Polygon') {
        paths = geojson.coordinates.map((ring: [number, number][]) =>
          ring.map(([lng, lat]) => ({ lat, lng }))
        );
      } else if (geojson.type === 'MultiPolygon') {
        paths = geojson.coordinates.flatMap((polygon: [number, number][][]) =>
          polygon.map((ring: [number, number][]) =>
            ring.map(([lng, lat]) => ({ lat, lng }))
          )
        );
      }

      if (paths.length === 0) continue;

      // Draw county boundary
      const polygon = new google.maps.Polygon({
        paths,
        map: map.value,
        fillColor: 'transparent',
        fillOpacity: 0,
        strokeColor: '#666666',
        strokeWeight: 2,
        strokeOpacity: 0.8,
        clickable: false
      });

      countyPolygons.push(polygon);

      // Add county name label at centroid with custom HTML for better styling
      const centroid = calculateCentroid(paths);

      // Create custom HTML label with text stroke (halo)
      const labelDiv = document.createElement('div');
      labelDiv.style.cssText = `
        color: #1f2937;
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        text-shadow:
          -1px -1px 0 #fff,
           1px -1px 0 #fff,
          -1px  1px 0 #fff,
           1px  1px 0 #fff,
          -2px -2px 3px rgba(255,255,255,0.8),
           2px -2px 3px rgba(255,255,255,0.8),
          -2px  2px 3px rgba(255,255,255,0.8),
           2px  2px 3px rgba(255,255,255,0.8);
        pointer-events: none;
        white-space: nowrap;
      `;
      labelDiv.textContent = county.name;

      const overlay = new google.maps.OverlayView();
      overlay.onAdd = function() {
        const panes = this.getPanes();
        if (panes) {
          panes.overlayLayer.appendChild(labelDiv);
        }
      };

      overlay.draw = function() {
        const projection = this.getProjection();
        const position = projection.fromLatLngToDivPixel(new google.maps.LatLng(centroid.lat, centroid.lng));
        if (position) {
          labelDiv.style.left = position.x + 'px';
          labelDiv.style.top = position.y + 'px';
          labelDiv.style.position = 'absolute';
          labelDiv.style.transform = 'translate(-50%, -50%)';
        }
      };

      overlay.onRemove = function() {
        if (labelDiv.parentNode) {
          labelDiv.parentNode.removeChild(labelDiv);
        }
      };

      overlay.setMap(map.value);

      // Store the overlay instead of marker
      (countyLabels as any).push(overlay);
    }
  } catch (error) {
    console.error('Failed to display county boundaries:', error);
  }
}

// Toggle county boundaries visibility
async function toggleCounties() {
  if (showCounties.value) {
    await displayCountyBoundaries();
  } else {
    clearCountyPolygons()
  }
}

// Toggle Layton overlay layers
async function toggleLaytonOverlay(layerName: 'debris_hazards' | 'faults' | 'development_agreements') {
  const isEnabled = showLaytonOverlays.value[layerName];

  if (isEnabled) {
    // Load the layer data if not already loaded
    if (!laytonOverlayData.value[layerName]) {
      try {
        console.log(`Loading Layton overlay: ${layerName}`);
        const { fetchLaytonOverlayByName } = await import('../lib/supabase');
        const features = await fetchLaytonOverlayByName(layerName);
        laytonOverlayData.value[layerName] = features;
        console.log(`? Loaded ${features.length} features for ${layerName}`);
      } catch (error) {
        console.error(`Failed to load ${layerName}:`, error);
        showLaytonOverlays.value[layerName] = false; // Turn off if failed to load
        return;
      }
    }
  }

  // Update deck.gl layers
  await updateDeckLayers();
}

// Convert GeoJSON to Google Maps paths
function toPaths(geojson: ParcelRow['geojson']): google.maps.LatLngLiteral[][] {
  if (!geojson || !geojson.coordinates) return [];

  if (geojson.type === 'Polygon') {
    return (geojson.coordinates as [number, number][][]).map(
      ring => ring.map(([lng, lat]) => ({ lat, lng }))
    );
  } else if (geojson.type === 'MultiPolygon') {
    return (geojson.coordinates as [number, number][][][]).flatMap(
      poly => poly.map(ring => ring.map(([lng, lat]) => ({ lat, lng })))
    );
  }
  return [];
}

// Plot both Airtable markers and Supabase parcels
async function plotRows(shouldFitBounds = true) {
  if (!map.value) return;

  // Always clear markers (Airtable points)
  clearMarkers();

  // Only clear polygons on initial load or when toggling layer off
  // This keeps parcels visible during viewport changes
  if (!showParcels.value) {
    clearPolygons();
  }

  // Compute bounds differently per provider
  const boundsGoogle = MAP_PROVIDER === 'google' ? new google.maps.LatLngBounds() : null as any;
  const boundsLibre = MAP_PROVIDER !== 'google' ? new maplibregl.LngLatBounds() : null as any;
  let hasPoints = false;

  // 1. Plot Airtable markers (red dots) - only if showAirtableMarkers is true
  const airtableTasks = showAirtableMarkers.value ? props.rows.map(async (r) => {
    const f = r.fields || {};
    // Marker filtering: by City selection if any are explicitly chosen
    const markerCity = String(f.City || '').trim();
    const mChecks = props.markerCityChecks ?? markerCityChecks.value;
    const selectedCities = Object.entries(mChecks).filter(([,v]) => !!v).map(([k]) => k);
    if (selectedCities.length > 0 && markerCity && !selectedCities.includes(markerCity)) {
      return; // skip filtered-out city
    }
    const hasLatLng = typeof f.Latitude === 'number' && typeof f.Longitude === 'number';

    // Use Property Address field (preferred) or fallback to Address field
    const propertyAddress = f['Property Address'] || f.Address || '';
    const city = f.City ? `, ${f.City}` : '';
    const state = ', Utah'; // Always add Utah to ensure correct geocoding
    const full = hasLatLng ? '' : `${propertyAddress}${city}${state}`.trim();

    let pos: google.maps.LatLngLiteral | null = null;
    if (hasLatLng) {
      const candidate = { lat: Number(f.Latitude), lng: Number(f.Longitude) };
      if (isValidLatLng(candidate)) pos = candidate;
    } else if (ENABLE_GEOCODING && propertyAddress && full) {
      // Only geocode when we have a street address; skip city-only strings to avoid rate limits
      pos = await geocodeOne(full);
    }
    if (!isValidLatLng(pos as any)) return;
    const p = pos as { lat: number; lng: number };

    // Create marker per provider
    let m: any;
    if (MAP_PROVIDER === 'google') {
      m = new google.maps.Marker({
        map: map.value!,
        position: p,
        title: (f.Name || f.Nickname || propertyAddress || 'Candidate').toString(),
        icon: { url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' }
      });
    } else {
      m = new maplibregl.Marker({ color: '#dc2626' })
        .setLngLat([p.lng, p.lat])
        .addTo(map.value);
    }

    let airtableUrl = '';
    if (AIRTABLE_BASE && AIRTABLE_TABLE_ID) {
      airtableUrl = AIRTABLE_VIEW_ID
        ? `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${AIRTABLE_VIEW_ID}/${r.id}`
        : `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${r.id}`;
    }

    const dropboxUrl = f['Dropbox Folder URL'] || '';

    // Prepare display values with em-dash fallback for Size and Price
    const sizeRaw = f['Size (acres)'] ?? f.Size;
    const sizeNum = typeof sizeRaw === 'number' ? sizeRaw : parseFloat(String(sizeRaw ?? '').replace(/[^0-9.\-]/g, ''));
    const sizeTextInline = Number.isFinite(sizeNum) ? `${Number(sizeNum).toFixed(2)} ac` : '&mdash;';

    const priceRaw = f.Price;
    const priceNum = typeof priceRaw === 'number' ? priceRaw : parseFloat(String(priceRaw ?? '').replace(/[^0-9.\-]/g, ''));
    const priceTextInline = Number.isFinite(priceNum)
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(priceNum)
      : '&mdash;';

    let html = `
      <div class="cw-popup" style="min-width:21.25rem; line-height:1.8; font-size:1rem; font-weight:400; padding:0.5rem;">
        <div style="font-size:0.8125rem; color:#dc2626; text-transform:uppercase; letter-spacing:0.03125rem; margin-bottom:0.75rem; text-align:center;">
          AIRTABLE RECORD
        </div>
        <div style="font-size:1.25rem; color:#1f2937; margin-bottom:0.5rem; text-align:center;">
          ${f.Name || f.Nickname || 'Candidate'}
        </div>
        <div style="font-size:0.9375rem; color:#6b7280; margin-bottom:1rem; text-align:center;">${propertyAddress || ''} ${city}</div>
        <div style="display:flex; gap:1.25rem; margin-bottom:0.5rem; font-size:1rem; justify-content:center;">
          <div><span style="color:#6b7280;">Size:</span> ${f['Size (acres)'] ?? f.Size ?? '?'} ac</div>
          <div><span style="color:#6b7280;">Price:</span> <span style="color:#111827;">${priceTextInline}</span></div>
        </div>
        ${airtableUrl ? `<div style="margin-top:1rem; padding-top:1rem; border-top:1px solid #e5e7eb; text-align:center;">
          <a href="${airtableUrl}" target="_blank" rel="noopener" style="color:#2563eb; text-decoration:none; font-size:0.9375rem;">
            Open in Airtable &rarr;
          </a>
        </div>` : ''}
        ${dropboxUrl ? `<div style="margin-top:0.5rem; text-align:center;">
          <a href="${dropboxUrl}" target="_blank" rel="noopener" style="color:#2563eb; text-decoration:none; font-size:0.9375rem;">
            Open Dropbox Folder &rarr;
          </a>
        </div>` : ''}
      </div>`;

    // Normalize the Size line in case original fields were missing (not bold)
    html = html.replace(
      /<div><span style=\"color:#6b7280;\">Size:<\/span>[^<]*<\/div>/,
      `<div><span style=\"color:#6b7280;\">Size:<\/span> <span style=\"color:#111827;\">${sizeTextInline}<\/span><\/div>`
    );

    // Popup/InfoWindow per provider
    if (MAP_PROVIDER === 'google') {
      // const iw = new google.maps.InfoWindow({ content: html });
      const iw = new google.maps.InfoWindow({ content: html });
      m.addListener('click', () => {
        if (currentInfoWindow) currentInfoWindow.close();
        const posNow = m.getPosition?.();
        const latlng = posNow ? (posNow.toJSON ? posNow.toJSON() : { lat: (posNow as any).lat(), lng: (posNow as any).lng() }) : null;
        if (latlng) try { map.value.panTo(latlng); } catch {}
        iw.open({ map: map.value!, anchor: m });
        currentInfoWindow = iw;
      });
      infoWindowsById[r.id] = iw as any;
    } else {
      const popup = new maplibregl.Popup({
        closeButton: true,
        maxWidth: '360px',
        offset: 25
      })
        .setHTML(html);

      // Add click listener to the marker element
      const markerElement = m.getElement();
      if (markerElement) {
        markerElement.style.cursor = 'pointer';
        markerElement.addEventListener('click', (e: Event) => {
          e.stopPropagation();
          // Close any existing popup
          if (currentInfoWindow && currentInfoWindow.remove) {
            currentInfoWindow.remove();
          }
          const p = pos as { lat: number; lng: number };
          popup.setLngLat([p.lng, p.lat]).addTo(map.value);

          // Center the map with offset for better visibility
          try {
            const point = map.value.project([p.lng, p.lat]);
            const offsetPoint = { x: point.x, y: point.y - 150 };
            const newCenter = map.value.unproject(offsetPoint);
            map.value.easeTo({ center: [newCenter.lng, newCenter.lat], duration: 350 });
          } catch {}
          currentInfoWindow = popup as any;
        });
      }
      infoWindowsById[r.id] = popup as any;
    }
    
    markers.push(m as any);
    markersById[r.id] = m as any;
    if (MAP_PROVIDER === 'google') boundsGoogle.extend(p as any);
    else boundsLibre.extend([p.lng, p.lat]);
    hasPoints = true;
  }) : [];

  await Promise.allSettled(airtableTasks);

  // Only fit bounds on initial load, not on viewport changes
  if (shouldFitBounds && hasPoints && !userHasInteracted) {
    const maxZoom = Math.max(0, Number(PARCELS_TILES_MIN_ZOOM) || 0);
    if (MAP_PROVIDER === 'google' && boundsGoogle && !boundsGoogle.isEmpty()) {
      console.log('Fitting map (Google) to bounds');
      try {
        (map.value as any).fitBounds(boundsGoogle, { maxZoom });
      } catch {
        map.value.fitBounds(boundsGoogle);
      }
    } else if (MAP_PROVIDER !== 'google' && boundsLibre) {
      console.log('Fitting map (MapLibre) to bounds');
      map.value.fitBounds(boundsLibre, { padding: 40, maxZoom });
    }
  } else {
    console.log('Skipping fitBounds - shouldFitBounds:', shouldFitBounds, 'hasPoints:', hasPoints);
  }
}

// Cache for counties FeatureCollection (MapLibre path)
let countiesGeojson: any | null = null;

// Cache for live parcel GeoJSON to avoid refetching unchanged viewports
let parcelCache: { bounds: string; data: any; timestamp: number } | null = null;
const PARCEL_CACHE_TTL = 60000; // 60 seconds - increased for better performance
async function loadCountiesGeojson(): Promise<any> {
  if (countiesGeojson) return countiesGeojson;
  const { fetchCounties } = await import('../lib/supabase');
  const rows = await fetchCounties();
  const features = (rows || []).map((c: any) => {
    const geom = typeof c.geom === 'string' ? JSON.parse(c.geom) : c.geom;
    return geom ? { type: 'Feature', geometry: geom, properties: { name: c.name, id: c.id } } : null;
  }).filter(Boolean);
  countiesGeojson = { type: 'FeatureCollection', features };
  return countiesGeojson;
}

async function createCountiesLayer() {
  try {
    const data = await loadCountiesGeojson();
    if (!data) return null;
    // Two-line technique: dark halo behind off-white stroke for maximum contrast on satellite
    const halo = new GeoJsonLayer({
      id: 'county-boundaries-halo',
      data,
      filled: false,
      stroked: true,
      getLineColor: [0, 0, 0, 160], // dark halo behind
      lineWidthMinPixels: 4,
      pickable: false,
      parameters: { depthTest: false }
    });
    const stroke = new GeoJsonLayer({
      id: 'county-boundaries-stroke',
      data,
      filled: false,
      stroked: true,
      // Off-white with ~80% opacity
      getLineColor: [253, 253, 253, 204],
      lineWidthMinPixels: 2,
      pickable: false,
      parameters: { depthTest: false }
    });
    return [halo, stroke];
  } catch (e) {
    console.warn('Failed to create counties layer', e);
    return null;
  }
}

// Focus on specific marker by ID
function focusOn(id: string) {
  if (!map.value) return;
  const m = markersById[id];
  const iw = infoWindowsById[id];
  if (!m) return;
  
  if (MAP_PROVIDER === 'google') {
    const pos = m.getPosition?.();
    if (pos) { 
      const latlng = pos.toJSON ? pos.toJSON() : { lat: (pos as any).lat(), lng: (pos as any).lng() };
      try {
        map.value.panTo(latlng);
        map.value.setZoom(15);
      } catch (e) {
        console.error('Failed to pan to marker', e);
      }
    }
    if (iw) iw.open({ map: map.value!, anchor: m });
  } else {
    const el = m.getElement?.();
    const lngLat = m.getLngLat?.();
    if (lngLat) {
      map.value.easeTo({ center: [lngLat.lng, lngLat.lat], zoom: 15, duration: 350 });
      if (iw?.setLngLat) iw.setLngLat([lngLat.lng, lngLat.lat]).addTo(map.value);
    } else if (el) {
      // no-op fallback
    }
  }
}

// Toggle Airtable markers visibility
function toggleAirtableMarkers() {
  // Re-plot markers
  plotRows(false);
}

// Toggle parcel layer visibility
async function toggleParcels() {
  // If turning off parcels, also clear any old Google polygons
  if (!showParcels.value) {
    clearPolygons();
  }

  // Save current viewport to prevent unwanted zoom changes
  const currentCenter = map.value?.getCenter();
  const currentZoom = map.value?.getZoom();

  // Always recompute layers so GP/counties remain visible when parcels are off
  await updateDeckLayers();

  // Restore viewport if it changed unexpectedly
  if (map.value && currentCenter && currentZoom) {
    const newCenter = map.value.getCenter();
    const newZoom = map.value.getZoom();

    // Check if viewport changed significantly (more than small drift)
    const centerChanged = Math.abs(newCenter.lng - (currentCenter.lng || currentCenter[0])) > 0.1 ||
                         Math.abs(newCenter.lat - (currentCenter.lat || currentCenter[1])) > 0.1;
    const zoomChanged = Math.abs(newZoom - currentZoom) > 0.5;

    if (centerChanged || zoomChanged) {
      console.log('Restoring viewport after parcel toggle');
      // Restore the original viewport
      if (MAP_PROVIDER === 'google') {
        map.value.setCenter(currentCenter);
        map.value.setZoom(currentZoom);
      } else {
        map.value.jumpTo({ center: [currentCenter.lng || currentCenter[0], currentCenter.lat || currentCenter[1]], zoom: currentZoom });
      }
    }
  }
}

// Create search results layer (highlighted parcels)
function createSearchResultsLayer() {
  if (!showSearchResults.value || searchResults.value.length === 0) {
    return null;
  }

  // Convert search results to GeoJSON features
  const features = searchResults.value.map((parcel: any) => {
    const geom = typeof parcel.geom === 'string' ? JSON.parse(parcel.geom) : parcel.geom;
    return {
      type: 'Feature' as const,
      geometry: geom,
      properties: {
        id: parcel.id,
        apn: parcel.apn,
        address: parcel.address,
        city: parcel.city,
        prop_class: parcel.prop_class,
        bldg_sqft: parcel.bldg_sqft,
        built_yr: parcel.built_yr,
        total_mkt_value: parcel.total_mkt_value,
        parcel_acres: parcel.parcel_acres
      }
    };
  });

  const geojson = {
    type: 'FeatureCollection' as const,
    features
  };

  // Create a bright highlighted layer for search results
  return new GeoJsonLayer({
    id: 'search-results-layer',
    data: geojson as any,
    pickable: true,
    stroked: true,
    filled: true,
    getFillColor: [255, 152, 0, 100], // Bright orange fill
    getLineColor: [255, 87, 34, 255], // Deep orange outline
    getLineWidth: 3,
    lineWidthUnits: 'pixels',
    onClick: (info: any) => {
      if (!info?.object) return;
      const { apn } = info.object.properties;
      handlePick({ apn, coordinate: info.coordinate, props: info.object.properties });
    }
  });
}

// Execute parcel search
async function executeParcelSearch() {
  isSearching.value = true;
  searchError.value = '';

  try {
    // Build query parameters for search_parcels function
    const params: any = {
      min_acres: null,
      max_acres: null,
      prop_classes: null,
      min_value: null,
      max_value: null,
      has_building: null,
      county_filter: 'Davis',
      cities: null,
      result_limit: 5000
    };
    // Normalize numeric inputs: treat '', undefined, NaN as null
    const numOrNull = (v: any) => {
      if (v === '' || v === null || v === undefined) return null;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const minAcres = numOrNull(searchFilters.value.minAcres);
    const maxAcres = numOrNull(searchFilters.value.maxAcres);
    const minValue = numOrNull(searchFilters.value.minValue);
    const maxValue = numOrNull(searchFilters.value.maxValue);

    if (minAcres !== null) params.min_acres = minAcres;
    if (maxAcres !== null) params.max_acres = maxAcres;
    if (minValue !== null) params.min_value = minValue;
    if (maxValue !== null) params.max_value = maxValue;
    // Building status removed from UI; do not constrain by building

    // Filter out empty strings from arrays
    const propClasses = searchFilters.value.propClass.filter(c => c !== '');
    if (propClasses.length > 0) params.prop_classes = propClasses;

    const cities = searchFilters.value.cities.filter(c => c !== '');
    // If cities are selected, fetch municipal polygons and do client-side spatial filtering
    let muniFeatures: any[] = [];
    let useClientSpatialCityFilter = false;
    if (cities.length > 0) {
      try {
        muniFeatures = await fetchMunicipalPolygonsFor(cities);
        if (Array.isArray(muniFeatures) && muniFeatures.length > 0) {
          // Do not set params.cities so SQL returns parcels with missing city
          useClientSpatialCityFilter = true;
        } else {
          // fall back to attribute city filter in SQL
          params.cities = cities;
        }
      } catch {
        params.cities = cities;
      }
    }

    // Require at least one constraint to avoid full-table scans
    const anyConstraint = (
      minAcres !== null ||
      maxAcres !== null ||
      (Array.isArray(params.prop_classes) && params.prop_classes.length > 0) ||
      minValue !== null ||
      maxValue !== null ||
      (Array.isArray(params.cities) && params.cities.length > 0)
    );
    if (!anyConstraint) {
      isSearching.value = false;
      searchError.value = 'Add at least one filter (class, city, acreage, or value).';
      return;
    }

    console.log('Search params:', params);

    // Call the search_parcels function
    // Call RPC with one automatic retry on timeout/network errors
    async function rpcWithRetry(p: any) {
      try {
        const res = await supabase.rpc('search_parcels', p);
        if (res.error && String(res.error?.message || '').toLowerCase().includes('timeout')) {
          await new Promise(r => setTimeout(r, 500));
          return await supabase.rpc('search_parcels', p);
        }
        return res;
      } catch (e: any) {
        // Retry once on fetch/abort/network errors
        await new Promise(r => setTimeout(r, 500));
        return await supabase.rpc('search_parcels', p);
      }
    }
    const { data, error } = await rpcWithRetry(params);

    if (error) {
      throw error;
    }

    let results = data || [];
    // Apply client-side municipal spatial filtering if applicable
    if (useClientSpatialCityFilter && cities.length > 0 && results.length > 0) {
      const wantedNorm = cities.map(c => normPlaceName(c)!).filter(Boolean);
      // Pre-normalize city polygon features by name
      const muniGroups: Record<string, any[]> = {};
      for (const f of muniFeatures) {
        const raw = f?.properties?.NAME || f?.properties?.CITY || f?.properties?.MUNICIPALITY || f?.properties?.LABEL || '';
        const n = normPlaceName(String(raw));
        if (!n) continue;
        if (!muniGroups[n]) muniGroups[n] = [];
        muniGroups[n].push(f);
      }
      results = results.filter((p: any) => {
        const pCityNorm = normPlaceName(p.city);
        // Include if attribute city already matches prefix
        if (pCityNorm && wantedNorm.some(n => (pCityNorm as string).startsWith(n))) return true;
        // Else spatial test via centroid-in-polygon
        const geom = typeof p.geom === 'string' ? JSON.parse(p.geom) : p.geom;
        const ctr = polygonCentroid(geom);
        if (!ctr) return false;
        for (const n of wantedNorm) {
          const fs = muniGroups[n] || [];
          for (const f of fs) {
            if (pointInPolygon(ctr, f.geometry)) return true;
          }
        }
        return false;
      });
    }
    searchResults.value = results;
    showSearchResults.value = searchResults.value.length > 0;

    // Trigger deck.gl layer update to show search results
    updateDeckLayers();

    if (searchResults.value.length === 0) {
      searchError.value = 'No parcels found matching your criteria.';
    }
  } catch (error: any) {
    console.error('Search error:', error);
    searchError.value = `Search failed: ${error.message || 'Unknown error'}`;
    searchResults.value = [];
  } finally {
    isSearching.value = false;
  }
}

// Clear search filters
function clearSearchFilters() {
  searchFilters.value.propClass = [];
  searchFilters.value.minAcres = null;
  searchFilters.value.maxAcres = null;
  searchFilters.value.minValue = null;
  searchFilters.value.maxValue = null;
  searchFilters.value.cities = [];
  searchError.value = '';
}

// Clear search results
function handleClearSearchResults() {
  searchResults.value = [];
  showSearchResults.value = false;
  searchError.value = '';
  // Trigger deck.gl layer update to remove search results layer
  updateDeckLayers();
}

// Zoom to the extent of current search results
function zoomToSearchResults() {
  if (!map.value || !searchResults.value || searchResults.value.length === 0) return;

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

  const updateBoundsFromCoords = (coords: any) => {
    // coords can be [lng,lat] or nested arrays
    if (Array.isArray(coords) && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lng = coords[0];
      const lat = coords[1];
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    } else if (Array.isArray(coords)) {
      for (const c of coords) updateBoundsFromCoords(c);
    }
  };

  for (const p of searchResults.value) {
    const geom = typeof p.geom === 'string' ? JSON.parse(p.geom) : p.geom;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      updateBoundsFromCoords(geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      updateBoundsFromCoords(geom.coordinates);
    }
  }

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) return;

  // If degenerate, pad slightly
  if (Math.abs(maxLng - minLng) < 1e-6 && Math.abs(maxLat - minLat) < 1e-6) {
    const pad = 0.001;
    minLng -= pad; maxLng += pad; minLat -= pad; maxLat += pad;
  }

  if (MAP_PROVIDER === 'google') {
    try {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(new google.maps.LatLng(minLat, minLng));
      bounds.extend(new google.maps.LatLng(maxLat, maxLng));
      map.value.fitBounds(bounds);
    } catch (e) {
      console.warn('fitBounds failed (google):', e);
    }
  } else {
    try {
      map.value.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40, duration: 400 });
    } catch (e) {
      console.warn('fitBounds failed (maplibre):', e);
    }
  }
}

// Export search results to CSV
async function exportSearchResults() {
  if (searchResults.value.length === 0) return;

  // Fetch enriched parcel rows (to include owner info) by APNs
  const apns = Array.from(new Set(searchResults.value.map((p: any) => String(p.apn || '')))).filter(Boolean);
  const CHUNK = 500;
  const records: any[] = [];
  for (let i = 0; i < apns.length; i += CHUNK) {
    const slice = apns.slice(i, i + CHUNK);
    const { supabase } = await import('../lib/supabase');
    const { data, error } = await supabase.from('parcels').select('*').in('apn', slice);
    if (error) { console.error('CSV fetch failed', error); continue; }
    if (data) records.push(...data);
  }

  // Header including owner info
  const headers = [
    'APN','Address','City','County','ZIP','Size (acres)','Property Class','Total Market Value','Building SqFt','Year Built',
    'Owner Name','Owner Address','Owner City','Owner State','Owner ZIP','Property URL'
  ];

  const needsQuote = (s: string) => s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r');
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return needsQuote(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines: string[] = [];
  lines.push(headers.join(','));

  for (const r of records) {
    const row = [
      r.apn,
      r.address,
      r.city,
      r.county,
      r.zip_code,
      r.parcel_acres ?? r.size_acres,
      r.prop_class,
      r.total_mkt_value,
      r.bldg_sqft,
      r.built_yr ?? r.year_built,
      r.owner_name,
      r.owner_address,
      r.owner_city,
      r.owner_state,
      r.owner_zip,
      r.property_url,
    ].map(esc).join(',');
    lines.push(row);
  }

  // Keep APNs with no fetched record
  const found = new Set(records.map(r => String(r.apn)));
  for (const apn of apns) {
    if (!found.has(apn)) {
      lines.push([apn].concat(Array(headers.length - 1).fill('')).join(','));
    }
  }

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `parcel_search_results_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Helper function to zoom to a parcel and open its popup
function zoomToParcel(parcelData: any, geojson: any) {
  if (!map.value) return;

  // Calculate center of parcel
  let centerLat = 0;
  let centerLng = 0;
  let pointCount = 0;

  if (geojson.type === 'Polygon') {
    geojson.coordinates[0].forEach((coord: [number, number]) => {
      centerLng += coord[0];
      centerLat += coord[1];
      pointCount++;
    });
  } else if (geojson.type === 'MultiPolygon') {
    geojson.coordinates.forEach((polygon: any) => {
      polygon[0].forEach((coord: [number, number]) => {
        centerLng += coord[0];
        centerLat += coord[1];
        pointCount++;
      });
    });
  }

  if (pointCount > 0) {
    centerLat /= pointCount;
    centerLng /= pointCount;

    // Zoom to parcel
    if (MAP_PROVIDER === 'google') {
      map.value.setCenter({ lat: centerLat, lng: centerLng });
      map.value.setZoom(18);
    } else {
      map.value.easeTo({ center: [centerLng, centerLat], zoom: 18 });
    }

    // Wait for parcels to load, then click on the parcel
    if (MAP_PROVIDER === 'google') {
      setTimeout(() => {
        const polygon = polygonsByApn[parcelData.apn];
        if (polygon) {
          google.maps.event.trigger(polygon, 'click', {
            latLng: new google.maps.LatLng(centerLat, centerLng)
          });
        }
      }, 2000);
    }

    console.log('Zoomed to parcel:', parcelData.apn);
  }
}

// Focus on a specific parcel by APN or address
async function focusOnParcel(apn?: string, address?: string, city?: string) {
  if (!map.value) return;

  console.log('Searching for parcel:', { apn, address, city });

  // Enable parcels layer if not already enabled
  if (!showParcels.value) {
    showParcels.value = true;
  }

  try {
    const { supabase } = await import('../lib/supabase');
    let query = supabase.from('parcels').select('*');

    if (apn) {
      query = query.eq('apn', apn);
    } else if (address) {
      // Normalize address - convert "East" to "E", "West" to "W", etc.
      let normalizedAddress = address.trim().toUpperCase()
        .replace(/\s+/g, ' ')
        .replace(/\bEAST\b/g, 'E')
        .replace(/\bWEST\b/g, 'W')
        .replace(/\bNORTH\b/g, 'N')
        .replace(/\bSOUTH\b/g, 'S')
        .replace(/\bSTREET\b/g, 'ST')
        .replace(/\bROAD\b/g, 'RD')
        .replace(/\bAVENUE\b/g, 'AVE')
        .replace(/\bDRIVE\b/g, 'DR')
        .replace(/\bLANE\b/g, 'LN')
        .replace(/\bCOURT\b/g, 'CT')
        .replace(/\bPLACE\b/g, 'PL')
        .replace(/\bBOULEVARD\b/g, 'BLVD');

      console.log('Normalized address:', normalizedAddress);

      // Search by address
      query = query.ilike('address', `%${normalizedAddress}%`);

      // Add city filter if provided for more accurate results
      if (city) {
        const cleanCity = city.trim().toUpperCase();
        query = query.ilike('city', `%${cleanCity}%`);
      }
    } else {
      return;
    }

    const { data, error } = await query.limit(1);

    if (error) {
      console.error('Error querying parcel:', error);
      alert(`Error searching for parcel: ${error.message}`);
      return;
    }

    if (!data || data.length === 0) {
      console.error('Parcel not found');
      alert(`Parcel not found${apn ? ' with APN: ' + apn : address ? ` with address: ${address}${city ? ' in ' + city : ''}` : ''}.\n\nNote: Address formats in the database may vary. Try adding the APN field to your Airtable record for 100% reliable results.`);
      return;
    }

    const parcelData = data[0];

    // Parse geometry
    const geojson = parcelData.geom ? (typeof parcelData.geom === 'string' ? JSON.parse(parcelData.geom) : parcelData.geom) : null;
    if (!geojson) {
      console.error('No geometry found for parcel');
      return;
    }

    // Use helper function to zoom to parcel
    zoomToParcel(parcelData, geojson);
  } catch (error) {
    console.error('Error finding parcel:', error);
  }
}

// Check URL parameters on mount
function checkUrlParameters() {
  const params = new URLSearchParams(window.location.search);
  const apn = params.get('apn');
  const address = params.get('address');
  const city = params.get('city');
  const recordId = params.get('recordId');

  if (apn || address || recordId) {
    console.log('URL parameters detected:', { apn, address, city, recordId });
    return true; // Indicate that we have URL parameters
  }
  return false;
}

defineExpose({
  focusOn,
  focusOnParcel,
  // Parcel search
  searchFilters,
  searchResults,
  isSearching,
  searchError,
  executeParcelSearch,
  clearSearchFilters,
  handleClearSearchResults,
  zoomToSearchResults,
  exportSearchResults
});

onMounted(async () => {
  await ensureMap();
  loadSelection();

  // Load county boundaries on map initialization
  if (showCounties.value) {
    await displayCountyBoundaries();
  }

  // Check for URL parameters first
  const hasUrlParams = checkUrlParameters();

  // Only plot Airtable markers if we don't have URL parameters
  // (skip auto-fitting to bounds when navigating directly to a parcel)
  if (props.rows?.length) {
    await plotRows(!hasUrlParams); // Don't fit bounds if we have URL params
  }

  // Navigate to parcel from URL parameters
  if (hasUrlParams) {
    const params = new URLSearchParams(window.location.search);
    const apn = params.get('apn');
    const address = params.get('address');
    const city = params.get('city');
    const recordId = params.get('recordId');

    if (recordId) {
      setTimeout(() => {
        focusOn(recordId);
      }, 500); // Shorter delay as we don't need to fetch parcels
    } else {
      setTimeout(() => {
        focusOnParcel(apn || undefined, address || undefined, city || undefined);
      }, 1000);
    }
  }

  // Add listener to reload parcels when map moves or zooms (if parcels are enabled)
  if (map.value) {
    let reloadTimer: number | undefined;
    let isLoading = false;
    let currentRequest = 0; // Track request version to cancel outdated requests

    const handleIdle = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      // Optimized debounce - shorter for better responsiveness
      reloadTimer = window.setTimeout(async () => {
        if (isLoading) return; // Skip if already loading
        isLoading = true;
        const requestId = ++currentRequest; // Increment request ID

        try {
          console.log('Map idle, updating deck.gl layers...');
          await updateDeckLayers();

          // If a newer request started while we were loading, skip the result
          if (requestId !== currentRequest) {
            console.log('Discarding outdated layer update');
            return;
          }
        } finally {
          isLoading = false;
        }
      }, 300); // Reduced from 800ms to 300ms for better responsiveness
    };

    if (MAP_PROVIDER === 'google' && typeof map.value.addListener === 'function') {
      map.value.addListener('idle', handleIdle);
    } else if (MAP_PROVIDER !== 'google' && typeof map.value.on === 'function') {
      map.value.on('moveend', handleIdle);
      map.value.on('zoomend', handleIdle);
    }
  }

  // Pre-warm Supabase/PostGIS to avoid first-run latency
  try {
    const warmParams: any = { county_filter: 'Davis', result_limit: 1, max_acres: 0.01 };
    // Fire-and-forget in a safe async IIFE
    void (async () => { try { await supabase.rpc('search_parcels', warmParams); } catch {} })();
  } catch {}
});

watch(() => props.rows, async (newRows) => {
  if (newRows?.length && map.value) {
    // Don't auto-zoom if user has already interacted with the map
    await plotRows(!userHasInteracted);
  }
}, { deep: true });

// Toggle deck pointer events when switching selection mode
watch(() => selectionEnabled.value, () => {
  // Keep pointer events enabled so clicks open popups or toggle selection
  setDeckPointerMode(true);
});

// When Layton GP is toggled on, lazily build its legend entries (no auto-zoom)
watch(() => showLaytonGeneralPlan.value, async (enabled) => {
  if (enabled) {
    await loadLaytonLegend();
  }
});

// Re-render layers when the GP filter changes
watch(() => gpFilter.value, () => {
  updateDeckLayers();
});

// Re-filter markers when marker filters change (internal or external)
watch(() => markerCityChecks.value, () => { plotRows(false); }, { deep: true });
watch(() => props.markerCityChecks, () => { plotRows(false); }, { deep: true });

// Re-filter GP when checkbox selections change (internal or external)
watch(() => gpChecks.value, () => { updateDeckLayers(); }, { deep: true });
watch(() => props.gpChecks, () => { updateDeckLayers(); }, { deep: true });

</script>

<template>
  <div style="position:relative; width:100%; height:100%;">
    <div ref="mapEl" class="map-canvas" style="width:100%; height:100%;"></div>

    <!-- Removed: Filters Panel (Top Left) migrated to App.vue -->
    <div v-if="false" class="cw-ui" style="position:absolute; bottom:auto; top:5rem; left:0.625rem; background:white; padding:1rem 1.25rem; border-radius:0.5rem; box-shadow:0 0.125rem 0.5rem rgba(0,0,0,0.15); z-index:1003; min-width:14rem; max-height:calc(100vh - 12rem); overflow-y:auto;">
      <div style="font-size:0.8125rem; font-weight:700; color:#1f2937; margin-bottom:0.875rem; text-transform:uppercase; letter-spacing:0.03125rem;">
        Filters
      </div>

      <!-- Land Database Markers Filter -->
      <div>
        <button @click="showLandFilterSection = !showLandFilterSection" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:0.5rem 0.75rem; cursor:pointer; font-weight:500; color:#374151; text-transform:uppercase; letter-spacing:0.05em; font-size:0.8125rem;">
          <span>Land Database</span>
          <span>{{ showLandFilterSection ? '-' : '+' }}</span>
        </button>
        <div v-show="showLandFilterSection" style="margin-top:0.5rem;">
          <div style="font-size:0.6875rem; color:#6b7280; margin-bottom:0.25rem; text-transform:uppercase; letter-spacing:0.06em;">City</div>
          <div style="display:flex; flex-direction:column; gap:0.25rem;">
            <label v-for="city in uniqueMarkerCities" :key="city" style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;">
              <input type="checkbox" v-model="markerCityChecks[city]" />
              <span>{{ city }}</span>
            </label>
          </div>
          <div style="margin-top:0.4rem; display:flex; gap:0.4rem;">
            <button @click="markerCitySelectAll" style="background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.6875rem; cursor:pointer;">All</button>
            <button @click="markerCitySelectNone" style="background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.6875rem; cursor:pointer;">None</button>
          </div>
        </div>
      </div>

      <!-- General Plan Filter -->
      <div style="margin-top:0.75rem;">
        <button @click="showGpFilterSection = !showGpFilterSection; if(showGpFilterSection) { try{ loadLaytonLegend(); } catch(e){} }" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:0.5rem 0.75rem; cursor:pointer; font-weight:500; color:#374151; text-transform:uppercase; letter-spacing:0.05em; font-size:0.8125rem;">
          <span>General Plan</span>
          <span>{{ showGpFilterSection ? '-' : '+' }}</span>
        </button>
        <div v-show="showGpFilterSection" style="margin-top:0.5rem;">
          <!-- Kaysville options -->
          <div style="font-size:0.6875rem; color:#6b7280; margin:0.25rem 0; text-transform:uppercase; letter-spacing:0.06em;">Kaysville</div>
          <div style="display:flex; flex-direction:column; gap:0.25rem;">
            <label v-for="item in gpLegend" :key="'kv-'+item.label" style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;">
              <input type="checkbox" v-model="gpChecks[item.label.toLowerCase()]" />
              <span>{{ item.label }}</span>
            </label>
          </div>
          <!-- Layton options -->
          <div style="font-size:0.6875rem; color:#6b7280; margin:0.5rem 0 0.25rem; text-transform:uppercase; letter-spacing:0.06em;">Layton</div>
          <div style="display:flex; flex-direction:column; gap:0.25rem;">
            <div v-if="laytonLegend.length === 0" style="font-size:0.8125rem; color:#6b7280;">Building legend?</div>
            <label v-else v-for="item in laytonLegend" :key="'ly-'+item.label" style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;">
              <input type="checkbox" v-model="gpChecks[item.label.toLowerCase()]" />
              <span>{{ item.label }}</span>
            </label>
          </div>
          <div style="margin-top:0.4rem; display:flex; gap:0.4rem; flex-wrap:wrap;">
            <button @click="gpClear" style="background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.6875rem; cursor:pointer;">Clear</button>
            <button @click="gpSelectAll" style="background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.6875rem; cursor:pointer;">All</button>
            <button @click="gpSelectNone" style="background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.6875rem; cursor:pointer;">None</button>
          </div>
        </div>
      </div>
    </div>
    <!-- Tools Toolbar (Top Right) -->
    <div class="cw-ui" style="position:absolute; top:0.75rem; right:0.625rem; background:white; padding:0.5rem 0.75rem; border-radius:0.5rem; box-shadow:0 0.125rem 0.5rem rgba(0,0,0,0.15); z-index:1004; display:flex; gap:0.5rem; align-items:center;">
      <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.8125rem; color:#374151;">
        <input type="checkbox" v-model="selectionEnabled" @change="()=>{}" style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#2563eb;" />
        <span>Select Parcels</span>
      </label>
      <span style="font-size:0.8125rem; color:#6b7280;">{{ selectedApns.size }} selected</span>
      <button @click="zoomToSelection" title="Zoom to selection" style="background:#f9fafb; border:1px solid #e5e7eb; color:#374151; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.75rem; cursor:pointer;">Zoom</button>
      <div style="position:relative;">
        <button @click="airtableMenuOpen = !airtableMenuOpen" title="Send selected to Airtable" style="background:#111827; color:#fff; border:1px solid #111827; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.75rem; cursor:pointer;">Send to Airtable &#9662;</button>
        <div v-if="airtableMenuOpen" style="position:absolute; right:0; top:2rem; background:white; border:1px solid #e5e7eb; border-radius:6px; box-shadow:0 0.125rem 0.5rem rgba(0,0,0,0.15); padding:0.25rem; display:flex; flex-direction:column; gap:0.25rem; z-index:1005; min-width:12rem;">
          <button @click="airtableMenuOpen=false; sendEachToLand();" style="background:#fff; border:1px solid #e5e7eb; color:#374151; border-radius:6px; padding:0.375rem 0.5rem; font-size:0.75rem; cursor:pointer; text-align:left;">Send Each &rarr; Land</button>
          <button @click="airtableMenuOpen=false; sendEachToOwner();" style="background:#fff; border:1px solid #e5e7eb; color:#374151; border-radius:6px; padding:0.375rem 0.5rem; font-size:0.75rem; cursor:pointer; text-align:left;">Send Each &rarr; Owner</button>
          <button @click="airtableMenuOpen=false; linkToOneLandRecord();" style="background:#fff; border:1px solid #e5e7eb; color:#374151; border-radius:6px; padding:0.375rem 0.5rem; font-size:0.75rem; cursor:pointer; text-align:left;">Send to One Land Record&hellip;</button>
        </div>
      </div>
      <button @click="exportSelectedCsv" title="Export selected to CSV" style="background:#f9fafb; border:1px solid #e5e7eb; color:#374151; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.75rem; cursor:pointer;">CSV</button>
      <button @click="clearSelection" style="background:#fef2f2; border:1px solid #fee2e2; color:#991b1b; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.75rem; cursor:pointer;">Clear</button>
      <span v-if="selectionMsg" style="font-size:0.75rem; color:#16a34a;">{{ selectionMsg }}</span>
      </div>


    <!-- Layer List Panel (Right Side, below basemap buttons) -->
    <div class="cw-ui" style="position:absolute; bottom:auto; top:5rem; right:0.625rem; background:white; padding:1rem 1.25rem; border-radius:0.5rem; box-shadow:0 0.125rem 0.5rem rgba(0,0,0,0.15); z-index:1003; min-width:12rem; max-height:calc(100vh - 12rem); overflow-y:auto;">
      <div style="font-size:0.8125rem; font-weight:700; color:#1f2937; margin-bottom:0.875rem; text-transform:uppercase; letter-spacing:0.03125rem;">
        Layers
      </div>

      <!-- Basemap Switcher (MapLibre only) -->
      <div v-if="MAP_PROVIDER !== 'google'" style="margin-bottom:1rem; padding-bottom:0.875rem; border-bottom:1px solid #e5e7eb;">
        <div style="font-size:0.75rem; font-weight:600; color:#6b7280; margin-bottom:0.5rem; text-transform:uppercase; letter-spacing:0.03125rem;">Basemap</div>
        <div style="display:flex; gap:0.5rem;">
          <button
            @click="switchBasemap('streets')"
            :style="{
              flex: 1,
              padding: '0.5rem',
              borderRadius: '6px',
              border: basemapType === 'streets' ? '2px solid #2563eb' : '1px solid #e5e7eb',
              background: basemapType === 'streets' ? '#eff6ff' : '#fff',
              color: basemapType === 'streets' ? '#2563eb' : '#6b7280',
              fontSize: '0.75rem',
              fontWeight: basemapType === 'streets' ? '700' : '500',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }"
          >
            Streets
          </button>
          <button
            @click="switchBasemap('satellite')"
            :style="{
              flex: 1,
              padding: '0.5rem',
              borderRadius: '6px',
              border: basemapType === 'satellite' ? '2px solid #2563eb' : '1px solid #e5e7eb',
              background: basemapType === 'satellite' ? '#eff6ff' : '#fff',
              color: basemapType === 'satellite' ? '#2563eb' : '#6b7280',
              fontSize: '0.75rem',
              fontWeight: basemapType === 'satellite' ? '700' : '500',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }"
          >
            Satellite
          </button>
        </div>
      </div>

      <!-- Airtable Markers Toggle -->
      <label style="display:flex; align-items:center; gap:0.625rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151; padding:0.375rem 0;">
        <input
          type="checkbox"
          v-model="showAirtableMarkers"
          @change="toggleAirtableMarkers"
          style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#dc2626;"
        />
        <span>Land Database (Airtable)</span>
      </label>

      <!-- County Boundaries Layer Toggle -->
      <label style="display:flex; align-items:center; gap:0.625rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151; padding:0.375rem 0;">
        <input
          type="checkbox"
          v-model="showCounties"
          @change="toggleCounties"
          style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#666666;"
        />
        <span>County Boundaries</span>
      </label>

      <!-- Davis County Group -->
      <div style="margin-top:0.5rem; padding-top:0.5rem; border-top:1px solid #e5e7eb;">
        <button @click="showDavisSection = !showDavisSection" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:0.5rem 0.75rem; cursor:pointer; font-weight:500; color:#374151; text-transform:uppercase; letter-spacing:0.05em;">
          <span>Davis County</span>
          <span>{{ showDavisSection ? '-' : '+' }}</span>
        </button>
        <div v-show="showDavisSection" style="margin-top:0.5rem;">
          <!-- General Plan Filter removed from layer panel (moved to Filters panel) -->
          <!-- Davis County Parcels Toggle -->
          <label style="display:flex; align-items:center; gap:0.625rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151; padding:0.375rem 0;">
            <input
              type="checkbox"
              v-model="showParcels"
              @change="toggleParcels"
              style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#2563eb;"
            />
            <span>Davis County Parcels</span>
          </label>

          <!-- Kaysville City Subsection (nested under Davis) -->
          <div style="margin-top:0.75rem; padding-top:0.75rem; border-top:1px solid #e5e7eb;">
            <button @click="showKaysvilleSection = !showKaysvilleSection" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#ffffff; border:1px solid #e5e7eb; border-radius:6px; padding:0.375rem 0.6rem; cursor:pointer; font-weight:400; color:#4b5563; text-transform:uppercase; letter-spacing:0.06em; font-size:0.8125rem;">
              <span>Kaysville</span>
              <span>{{ showKaysvilleSection ? '-' : '+' }}</span>
            </button>

            <div v-show="showKaysvilleSection" style="margin-top:0.5rem; margin-left:0.75rem;">
              <!-- Kaysville General Plan Toggle -->
              <label style="display:flex; align-items:center; gap:0.625rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151; padding:0.375rem 0;">
                <input
                  type="checkbox"
                  v-model="showGeneralPlan"
                  @change="updateDeckLayers()"
                  style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#7c3aed;"
                />
                <span>Kaysville General Plan (2022)</span>
                <button @click.stop="showKaysLegend = !showKaysLegend" style="margin-left:auto; background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.125rem 0.375rem; font-size:0.6875rem; font-weight:700; cursor:pointer;">{{ showKaysLegend ? 'Hide Legend' : 'Show Legend' }}</button>
              </label>
              <div v-if="showKaysLegend" style="margin:0.25rem 0 0.5rem 1.5rem; border:1px solid #e5e7eb; border-radius:8px; padding:0.5rem; max-height:12rem; overflow-y:auto;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; font-size:0.75rem; font-weight:700; color:#1f2937; margin-bottom:0.375rem; text-transform:uppercase; letter-spacing:0.03125rem;">
                  <span>Legend</span>
                  <span :style="{background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb', borderRadius:'9999px', padding:'0.125rem 0.5rem', fontSize:'0.6875rem', fontWeight:700}">{{ gpUsingTiles ? 'Tiles' : 'GeoJSON' }}</span>
                </div>
                <div>
                  <div v-for="item in gpLegend" :key="item.label" style="display:flex; align-items:center; gap:0.5rem; margin:0.2rem 0;">
                    <span :style="{ width:'14px', height:'14px', borderRadius:'3px', backgroundColor: rgbaToCss(item.color), border: '1px solid #9ca3af', display:'inline-block' }"></span>
                    <span style="font-size:0.8125rem; color:#374151;">{{ item.label }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Layton City Subsection (nested under Davis) -->
          <div style="margin-top:0.75rem; padding-top:0.75rem; border-top:1px solid #e5e7eb;">
            <button @click="showLaytonSection = !showLaytonSection" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#ffffff; border:1px solid #e5e7eb; border-radius:6px; padding:0.375rem 0.6rem; cursor:pointer; font-weight:400; color:#4b5563; text-transform:uppercase; letter-spacing:0.06em; font-size:0.8125rem;">
              <span>Layton</span>
              <span>{{ showLaytonSection ? '-' : '+' }}</span>
            </button>

            <div v-show="showLaytonSection" style="margin-top:0.5rem; margin-left:0.75rem;">
            <!-- Layton General Plan Toggle -->
          <label style="display:flex; align-items:center; gap:0.625rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151; padding:0.375rem 0;">
            <input
              type="checkbox"
              v-model="showLaytonGeneralPlan"
              @change="updateDeckLayers()"
              style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#9333ea;"
            />
            <span>Layton General Plan (2019)</span>
            <button @click.stop="showLaytonLegend = !showLaytonLegend; if(showLaytonLegend) loadLaytonLegend();" style="margin-left:auto; background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.125rem 0.375rem; font-size:0.6875rem; font-weight:700; cursor:pointer;">{{ showLaytonLegend ? 'Hide Legend' : 'Show Legend' }}</button>
          </label>
          <div v-if="showLaytonLegend" style="margin:0.25rem 0 0.5rem 1.5rem; border:1px solid #e5e7eb; border-radius:8px; padding:0.5rem; max-height:12rem; overflow-y:auto;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; font-size:0.75rem; font-weight:700; color:#1f2937; margin-bottom:0.375rem; text-transform:uppercase; letter-spacing:0.03125rem;">
              <span>Legend</span>
              <span :style="{background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb', borderRadius:'9999px', padding:'0.125rem 0.5rem', fontSize:'0.6875rem', fontWeight:700}">{{ gpLaytonUsingTiles ? 'Tiles' : 'GeoJSON' }}</span>
            </div>
            <div>
              <div v-if="laytonLegend.length === 0" style="font-size:0.8125rem; color:#6b7280;">Building legend?</div>
              <div v-else>
                <div v-for="item in laytonLegend" :key="item.label" style="display:flex; align-items:center; gap:0.5rem; margin:0.2rem 0;">
                  <span :style="{ width:'14px', height:'14px', borderRadius:'3px', backgroundColor: rgbaToCss(item.color), border: '1px solid #9ca3af', display:'inline-block' }"></span>
                  <span style="font-size:0.8125rem; color:#374151;">{{ item.label }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Layton Zoning Toggle (disabled) -->
          <!-- Zoning filter temporarily disabled -->

          <!-- Layton Overlay Layers Section -->
          <div style="margin-top:0.75rem; padding-top:0.75rem; border-top:1px solid #e5e7eb;">
            <div style="font-size:0.75rem; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.5rem;">
              Overlays
            </div>

            <!-- Debris Hazards -->
            <label style="display:flex; align-items:center; gap:0.625rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151; padding:0.375rem 0;">
              <input
                type="checkbox"
                v-model="showLaytonOverlays.debris_hazards"
                @change="toggleLaytonOverlay('debris_hazards')"
                style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#ffa500;"
              />
              <span>Debris Hazards</span>
            </label>

            <!-- Geological Faults -->
            <label style="display:flex; align-items:center; gap:0.625rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151; padding:0.375rem 0;">
              <input
                type="checkbox"
                v-model="showLaytonOverlays.faults"
                @change="toggleLaytonOverlay('faults')"
                style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#8b00ff;"
              />
              <span>Geological Faults</span>
            </label>

            <!-- Development Agreements -->
            <label style="display:flex; align-items:center; gap:0.625rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151; padding:0.375rem 0;">
              <input
                type="checkbox"
                v-model="showLaytonOverlays.development_agreements"
                @change="toggleLaytonOverlay('development_agreements')"
                style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#4169e1;"
              />
              <span>Development Agreements</span>
            </label>
          </div>
          </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Embedded Legends inside Layer Panel -->
  </div>

</template>




<style scoped>
/* Remove any default focus ring around the map container/canvas */
.map-canvas:focus { outline: none; }
.map-canvas :focus { outline: none; }
</style>


// removed duplicate (moved earlier)



