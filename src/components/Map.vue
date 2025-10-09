<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { GeoJsonLayer } from '@deck.gl/layers';
import { MVTLayer } from '@deck.gl/geo-layers';
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
  geojson: { type: 'Polygon' | 'MultiPolygon'; coordinates: any };
};

declare global {
  interface Window {
    pmtiles: any;
  }
}

// Props include Airtable records (id + fields)
const props = defineProps<{ rows: Array<{ id: string; fields: Record<string, any> }> }>();

// Refs
const mapEl = ref<HTMLDivElement | null>(null);
const map = ref<google.maps.Map | null>(null);
const markers: google.maps.Marker[] = [];
const polygons: google.maps.Polygon[] = [];
const polygonsByApn: Record<string, google.maps.Polygon> = {}; // Track polygons by APN
const markersById: Record<string, google.maps.Marker> = {};
const infoWindowsById: Record<string, google.maps.InfoWindow> = {};
let geocoder: google.maps.Geocoder | null = null;
const cache = new Map<string, google.maps.LatLngLiteral>();
let currentInfoWindow: google.maps.InfoWindow | null = null; // Track currently open info window
let deckOverlay: GoogleMapsOverlay | null = null; // deck.gl overlay for parcels
const showParcels = ref(false); // Toggle for parcel layer (start disabled)
const showCounties = ref(true); // Toggle for county boundaries layer (start enabled)
const showAirtableMarkers = ref(true); // Toggle for Airtable markers (start enabled)
const showGeneralPlan = ref(false); // Toggle for Kaysville General Plan layer
const showLaytonGeneralPlan = ref(false); // Toggle for Layton General Plan layer
const showKaysLegend = ref(false);
const showLaytonLegend = ref(false);
const showDavisSection = ref(true); // Collapse/expand Davis County group
const countyPolygons: google.maps.Polygon[] = []; // Store county boundary polygons
const countyLabels: google.maps.Marker[] = []; // Store county name labels

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

// Vector Tiles URL - for low/medium zoom levels
// For local dev: serve tiles directory via Vite public folder or separate server
// For production: upload to CDN (S3/R2/Cloudflare) and version the URL
const PARCELS_TILES_URL = (import.meta.env.VITE_PARCELS_TILES_URL as string) || '/tiles/{z}/{x}/{y}.pbf';
// Optional static General Plan GeoJSON served from /public
const GP_STATIC_URL = (import.meta.env.VITE_KAYSVILLE_GP_STATIC_URL as string | undefined);
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
    'mixed use Ã¢â‚¬â€œ commercial/residential': [120, 70, 45, 160],
    'mixed use commercial/residential':   [120, 70, 45, 160],
    'mixed use - light industrial/residential': [255, 160, 205, 160],
    'mixed use Ã¢â‚¬â€œ light industrial/residential': [255, 160, 205, 160],
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
    onClick: (info: any) => {
      if (!info?.object) return;
      showGeneralPlanPopup(info.object.properties || {}, info.coordinate);
    },
    updateTriggers: {
      getFillColor: [(f: any) => String(gpZoneFromProps(f.properties) || '').toLowerCase()],
    }
  });
}

// Prefer MVT for performance if URL provided
function createGeneralPlanLayer() {
  if (!gpForceStatic.value && GP_TILES_URL) {
    return new MVTLayer({
      id: 'general-plan-tiles',
      data: GP_TILES_URL,
      minZoom: GP_TILES_MIN_ZOOM,
      maxZoom: GP_TILES_MAX_ZOOM,
      pickable: true,
      getFillColor: (f: any) => gpFillColorFor(gpZoneFromProps(f.properties)),
      getLineColor: [40, 40, 40, 200],
      lineWidthMinPixels: 1,
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
    minZoom: LAYTON_GP_TILES_MIN_ZOOM,
    maxZoom: LAYTON_GP_TILES_MAX_ZOOM,
    pickable: true,
    filled: true,
    stroked: true,
    getFillColor: (f: any) => gpFillColorFor(gpZoneFromProps(f.properties)),
    getLineColor: [40, 40, 40, 200],
    lineWidthMinPixels: 2,
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
    onClick: (info: any) => {
      if (!info?.object) return;
      showGeneralPlanPopup(info.object.properties || {}, info.coordinate);
    },
    updateTriggers: {
      getFillColor: [(f: any) => String(gpZoneFromProps(f.properties) || '').toLowerCase()],
    }
  });
}

function showGeneralPlanPopup(props: any, coordinate: [number, number]) {
  if (!map.value) return;
  if (currentInfoWindow) currentInfoWindow.close();

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
    <div style="min-width:18rem; max-width:24rem; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color:#111827; margin-bottom: 0.5rem; padding:0.5rem;">
      <div style="text-align:center; font-size:0.75rem; font-weight:700; color:#6366f1; text-transform:uppercase; letter-spacing:0.05rem; margin-bottom:0.375rem;">
        General Plan Zone
      </div>
      <div style="text-align:center; font-size:1.0625rem; font-weight:700; line-height:1.25; margin-bottom:0.25rem;">${String(zoneName)}</div>
      ${zoneType ? `<div style=\"text-align:center; font-size:0.9rem; color:#6b7280; font-weight:600; margin-bottom:0.375rem;\">${String(zoneType)}</div>` : ''}
      ${generalized ? `<div style=\"text-align:center; font-size:0.8125rem; color:#4b5563; margin-bottom:0.25rem;\">${String(generalized)}</div>` : ''}
      ${acresText ? `<div style=\"text-align:center; font-size:0.8125rem; color:#4b5563; margin-bottom:0.25rem;\">${acresText}</div>` : ''}
      ${(county||city) ? `<div style=\"text-align:center; font-size:0.8125rem; color:#6b7280;\">${[city, county].filter(Boolean).join(', ')}</div>` : ''}
      ${moreInfo ? `<div style=\"text-align:center; margin-top:0.5rem;\"><a href=\"${moreInfo}\" target=\"_blank\" rel=\"noopener\" style=\"color:#2563eb; text-decoration:none; font-size:0.875rem;\">More Information →</a></div>` : ''}
    </div>
  `;

  currentInfoWindow = new google.maps.InfoWindow({
    content: html,
    position: { lat: coordinate[1], lng: coordinate[0] },
  });
  currentInfoWindow.open({ map: map.value });
}

// Add parcel to Airtable (Land Database table)
async function addParcelToAirtable(parcel: ParcelRow) {
  try {
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
      'APN': parcel.apn,
      'Size (acres)': parcel.size_acres,
      'ZIP': parcel.zip_code,
      'Owner Name': parcel.owner_name,
      'Mailing Address': mailingAddress,
      'City': parcel.city  // Only works if City is a text field, not dropdown
    };

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

// Load Google Maps API
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

// Initialize map
async function ensureMap() {
  const key = import.meta.env.VITE_GOOGLE_MAPS_KEY as string;
  if (!key) {
    console.error('Missing VITE_GOOGLE_MAPS_KEY in .env');
    return;
  }

  try {
    await loadGoogleMaps(key);
    if (!mapEl.value) return;

    // It's possible that google.maps is still undefined immediately after loading.
    // A short delay might be necessary.
    await new Promise(resolve => setTimeout(resolve, 50));
    map.value = new google.maps.Map(mapEl.value, { // use ! here
      center: { lat: 40.7608, lng: -111.8910 },
      zoom: 10,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: true, // Re-enable default map type controls
    });
    geocoder = new google.maps.Geocoder();

    // Initialize deck.gl overlay
    await initializeDeckOverlay();

  } catch (error) {
    console.error('Failed to initialize Google Maps:', error);
  }
}

// Initialize deck.gl overlay for GPU-accelerated parcel rendering
async function initializeDeckOverlay() {
  if (!map.value) return;

  // Create the overlay
  deckOverlay = new GoogleMapsOverlay({
    layers: []
  });

  // Attach to Google Maps
  deckOverlay.setMap(map.value);

  console.log('deck.gl overlay initialized');
}

// On-click handler for both tile and GeoJSON layers
async function handlePick({ apn, coordinate, props }: { apn: string, coordinate: [number, number], props: any }) {
  if (!map.value || !apn) return;

  // Immediately show info window with properties from the clicked feature (tile or GeoJSON)
  if (currentInfoWindow) {
    currentInfoWindow.close();
  }

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
  currentInfoWindow = new google.maps.InfoWindow({
    content: html,
    position: { lat: coordinate[1], lng: coordinate[0] },
  });

  // Close popup when user clicks the X
  currentInfoWindow.addListener('closeclick', () => {
    currentInfoWindow = null;
  });

  currentInfoWindow.open({ map: map.value });

  // Add event listeners for the buttons inside the InfoWindow
  google.maps.event.addListenerOnce(currentInfoWindow, 'domready', () => {
    const buttonId = `add-to-airtable-deck-${finalProps.id}`;
    const landownerButtonId = `add-to-landowner-airtable-deck-${finalProps.id}`;
    
    const button = document.getElementById(buttonId);
    if (button) {
      button.addEventListener('click', () => addParcelToAirtable(finalProps as ParcelRow));
    }

    const landownerButton = document.getElementById(landownerButtonId);
    if (landownerButton) {
      landownerButton.addEventListener('click', () => addParcelToLandownerAirtable(finalProps as ParcelRow));
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
    // ... any other button listeners ...
  });
}

// Build HTML content for parcel info window (deck.gl click)
function createStyledParcelInfoWindowHtml(p: ParcelRow): string {
  const title = (p.address || '').toString().toUpperCase() || (p.apn ? `PARCEL ${p.apn}` : 'PARCEL');
  const idSafe = p.id ?? 'x';
  const countyText = (p.county || '').toString() + ' County';
  const sizeText = p.size_acres != null ? `${Number(p.size_acres).toFixed(2)} acres` : '&mdash;';
  const apnText = p.apn || '&mdash;';
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
    <div style="min-width:23rem; max-width:26rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#111827; padding:0.5rem;">
      <div style="text-align:center; font-size:0.75rem; font-weight:700; color:#2563eb; text-transform:uppercase; letter-spacing:0.05rem; margin-bottom:0.75rem;">
        <svg width="12" height="12" viewBox="0 0 12 12" style="display:inline-block; vertical-align:middle; margin-right:0.25rem; margin-bottom:0.125rem;"><path d="M6 0 L12 6 L6 12 L0 6 Z" fill="#2563eb"/></svg>
        <span style="color:#2563eb;">${countyText.toUpperCase()} PARCEL</span>
      </div>
      <div style="text-align:center; font-size:1.375rem; font-weight:700; letter-spacing:-0.01rem; line-height:1.3; margin-bottom:0.5rem;">${title}</div>
      <div style="text-align:center; font-size:0.9375rem; color:#6b7280; font-weight:600; margin-bottom:1rem;">${countyText}</div>
      <div style="background:#f3f4f6; border-radius:8px; padding:1rem; margin-bottom:1rem;">
        <div style="text-align:center; font-size:0.6875rem; color:#6b7280; font-weight:700; letter-spacing:0.05rem; margin-bottom:0.75rem;">OWNER INFORMATION</div>
        ${ownerName ? `<div style="text-align:center; font-size:0.9375rem; font-weight:700; margin-bottom:0.375rem; color:#111827; line-height:1.4;">${ownerName}</div>` : ''}
        ${ownerAddr1 ? `<div style="text-align:center; font-size:0.875rem; color:#6b7280; line-height:1.4;">${ownerAddr1}</div>` : ''}
        ${ownerAddr2 ? `<div style="text-align:center; font-size:0.875rem; color:#6b7280; line-height:1.4;">${ownerAddr2}</div>` : ''}
      </div>
      <div style="text-align:center; margin-bottom:1rem;">
        <div style="font-size:0.9375rem; color:#6b7280; margin-bottom:0.375rem;">APN: <strong style="color:#111827;">${apnText}</strong></div>
        <div style="font-size:0.9375rem; color:#6b7280;">Size: <strong style="color:#111827;">${sizeText}</strong></div>
      </div>
      <div style="display:flex; flex-direction:column; gap:0.625rem; margin-bottom:1rem;">
        <button id="${airtableBtnId}" style="background:#000; color:#fff; border:none; border-radius:8px; padding:0.875rem 1rem; cursor:pointer; font-weight:700; font-size:0.9375rem;"><span style="color:#a78bfa; margin-right:0.5rem;">+</span>Add Parcel to Land Database</button>
        <button id="${landownerBtnId}" style="background:#000; color:#fff; border:none; border-radius:8px; padding:0.875rem 1rem; cursor:pointer; font-weight:700; font-size:0.9375rem;"><span style="color:#a78bfa; margin-right:0.5rem;">+</span>Add Owner to Landowner Database</button>
      </div>
      ${(viewLink || countySearch) ? `<div style="text-align:center; display:flex; flex-direction:column; gap:0.5rem; padding-top:0.5rem; border-top:1px solid #e5e7eb;">${viewLink ? `<div>${viewLink}</div>` : ''}${countySearch ? `<div>${countySearch}</div>` : ''}</div>` : ''}
    </div>`;
}

function createParcelsTileLayer() {
  return new MVTLayer({
    id: 'parcels-tiles',
    data: PARCELS_TILES_URL,
    pickable: true,
    getFillColor: [37, 99, 235, 38], // #2563eb with 15% opacity - matches GeoJsonLayer
    getLineColor: [30, 64, 175, 255], // #1e40af - matches GeoJsonLayer
    lineWidthMinPixels: 1,
    onClick: (info: any) => {
      if (!info?.object) return;
      const apn = info.object.properties?.apn;
      if (apn) {
        handlePick({ apn, coordinate: info.coordinate, props: info.object.properties });
      }
    }
  });
}

// Update deck.gl layers with parcel data
async function updateDeckLayers() {
  if (!deckOverlay || !map.value) {
    return;
  }

  // If all layers are disabled, clear layers
  if (!showParcels.value && !showGeneralPlan.value && !showLaytonGeneralPlan.value) {
    deckOverlay.setProps({ layers: [] });
    return;
  }

  // Check zoom level - only show parcels when zoomed in enough
  const zoom = map.value.getZoom() || 0;
  const MIN_PARCEL_ZOOM = 13; // Show parcels starting at zoom 13 (higher = need to zoom in more)
  if (showLaytonGeneralPlan.value && zoom > LAYTON_GP_TILES_MAX_ZOOM) {
    console.info(`Layton GP tiles max zoom is ${LAYTON_GP_TILES_MAX_ZOOM}. You are at z=${zoom.toFixed(1)}; tiles may 400 beyond their max. Consider increasing VITE_LAYTON_GP_TILES_MAX_ZOOM to keep the layer visible at higher zooms.`);
  }

  if (zoom < MIN_PARCEL_ZOOM) {
    console.log(`Zoom level ${zoom.toFixed(1)} too low. Zoom to ${MIN_PARCEL_ZOOM}+ to see parcels.`);
    const layersLow: any[] = [];
    if (showGeneralPlan.value) {
      const gp = createGeneralPlanLayer();
      if (gp) layersLow.push(gp);
    }
    if (showLaytonGeneralPlan.value) {
      const lay = createLaytonGeneralPlanLayer();
      if (lay) layersLow.push(lay);
    }
    deckOverlay.setProps({ layers: layersLow });
    return;
  }

  // Fetch live GeoJSON data from Supabase
  console.log(`Zoom ${zoom.toFixed(1)}: Fetching live GeoJSON data for entire viewport`);

  // Get current map bounds
  const bounds = map.value.getBounds();
  if (!bounds) return;

  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();

  // If parcels are disabled, but GP is enabled, render GP only
  if (!showParcels.value) {
    const onlyGp: any[] = [];
    if (showGeneralPlan.value) {
      const gp = createGeneralPlanLayer();
      if (gp) onlyGp.push(gp);
    }
    if (showLaytonGeneralPlan.value) {
      const lay = createLaytonGeneralPlanLayer();
      if (lay) onlyGp.push(lay);
    }
    deckOverlay.setProps({ layers: onlyGp });
    return;
  }

  try {
    console.log('Fetching parcels from Supabase for deck.gl...');
    const startTime = performance.now();

    // Call the parcels_in_bounds function using WKT bbox (existing RPC)
    const bbox = `POLYGON((${sw.lng()} ${sw.lat()}, ${ne.lng()} ${sw.lat()}, ${ne.lng()} ${ne.lat()}, ${sw.lng()} ${ne.lat()}, ${sw.lng()} ${sw.lat()}))`;

    // Use .limit() to get more parcels (Supabase default is 1000)
    // At zoomed out levels, we might have many parcels in view
    const { data, error } = await supabase
      .rpc('parcels_in_bounds', { bbox_wkt: bbox })
      .limit(10000); // Increase limit to handle large viewport areas

    if (error) {
      console.error('Error fetching parcels:', error);
      return;
    }

    const endTime = performance.now();
    console.log(`GÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ Fetched ${data?.length || 0} parcels in ${Math.round(endTime - startTime)}ms`);

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

    // Create GeoJsonLayer with unique ID based on timestamp to force refresh
    // This prevents "patchwork" effect from old parcel data lingering
    const parcelLayer = new GeoJsonLayer({
      id: 'parcels-layer',
      data: geojson as any,
      pickable: true,
      stroked: true,
      filled: true,
      getFillColor: [37, 99, 235, 38], // #2563eb with 15% opacity (38/255 = 0.15)
      getLineColor: [30, 64, 175, 255], // #1e40af
      getLineWidth: 2,
      lineWidthUnits: 'pixels', // Use 'pixels' for consistent line width
      getFeatureId: (f: any) => f.properties?.id,
      onClick: (info: any) => {
        if (!info?.object) return;
        const { apn } = info.object.properties;
        handlePick({ apn, coordinate: info.coordinate, props: info.object.properties });
      }
    });

    // Update overlay with parcels + optional General Plan
    const layersToSet: any[] = [parcelLayer];
    if (showGeneralPlan.value) {
      const gp = createGeneralPlanLayer();
      if (gp) layersToSet.push(gp);
    }
    if (showLaytonGeneralPlan.value) {
      const lay = createLaytonGeneralPlanLayer();
      if (lay) layersToSet.push(lay);
    }
    deckOverlay.setProps({ layers: layersToSet });

  } catch (error) {
    console.error('Failed to update deck.gl GeoJSON layer:', error);
  }
}

// Clear all markers and polygons
function clearMarkers() {
  for (const m of markers) m.setMap(null);
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

// Geocode address
async function geocodeOne(addr: string): Promise<google.maps.LatLngLiteral | null> {
  if (!geocoder) return null;
  if (cache.has(addr)) return cache.get(addr)!;

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
      return p;
    }
  } catch (e) {
    console.warn('Geocode failed for', addr, e);
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
    console.log(`GÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½n+ÃƒÂ¯Ã‚Â¿Ã‚Â½ Zoom level ${zoom} too low. Zoom to ${MIN_ZOOM}+ to see parcels.`);
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
    console.log(`GÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ Fetched ${parcels.length} parcels from Supabase in ${Math.round(endTime - startTime)}ms`);

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

  const bounds = new google.maps.LatLngBounds();
  let hasPoints = false;

  // 1. Plot Airtable markers (red dots) - only if showAirtableMarkers is true
  const airtableTasks = showAirtableMarkers.value ? props.rows.map(async (r) => {
    const f = r.fields || {};
    const hasLatLng = typeof f.Latitude === 'number' && typeof f.Longitude === 'number';

    // Use Property Address field (preferred) or fallback to Address field
    const propertyAddress = f['Property Address'] || f.Address || '';
    const city = f.City ? `, ${f.City}` : '';
    const state = ', Utah'; // Always add Utah to ensure correct geocoding
    const full = hasLatLng ? '' : `${propertyAddress}${city}${state}`.trim();

    let pos: google.maps.LatLngLiteral | null = null;
    if (hasLatLng) {
      pos = { lat: f.Latitude, lng: f.Longitude };
    } else if (full && full !== ', Utah') {
      pos = await geocodeOne(full);
    }
    if (!pos) return;

    const m = new google.maps.Marker({
      map: map.value!,
      position: pos,
      title: (f.Name || f.Nickname || propertyAddress || 'Candidate').toString(),
      icon: { url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' }
    });

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
      <div style="min-width:21.25rem; line-height:1.8; font-size:1rem; font-family: system-ui, -apple-system, sans-serif; font-weight:600; padding:0.5rem;">
        <div style="font-size:0.8125rem; color:#dc2626; text-transform:uppercase; letter-spacing:0.03125rem; margin-bottom:0.75rem; text-align:center;">
          AIRTABLE RECORD
        </div>
        <div style="font-size:1.25rem; color:#1f2937; margin-bottom:0.5rem; text-align:center;">
          ${f.Name || f.Nickname || 'Candidate'}
        </div>
        <div style="font-size:0.9375rem; color:#6b7280; margin-bottom:1rem; text-align:center;">${propertyAddress || ''} ${city}</div>
        <div style="display:flex; gap:1.25rem; margin-bottom:0.5rem; font-size:1rem; justify-content:center;">
          <div><span style="color:#6b7280;">Size:</span> ${f['Size (acres)'] ?? f.Size ?? '—'} ac</div>
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

    const iw = new google.maps.InfoWindow({ content: html });
    m.addListener('click', () => {
      // Close any previously open info window
      if (currentInfoWindow) {
        currentInfoWindow.close();
      }
      iw.open({ map: map.value!, anchor: m });
      currentInfoWindow = iw;
    });
    
    markers.push(m);
    markersById[r.id] = m;
    infoWindowsById[r.id] = iw;
    bounds.extend(pos);
    hasPoints = true;
  }) : [];

  await Promise.allSettled(airtableTasks);

  // Only fit bounds on initial load, not on viewport changes
  if (shouldFitBounds && hasPoints && !bounds.isEmpty()) {
    console.log('Fitting map to bounds:', bounds.toJSON());
    map.value.fitBounds(bounds);
  } else {
    console.log('Skipping fitBounds - shouldFitBounds:', shouldFitBounds, 'hasPoints:', hasPoints, 'isEmpty:', bounds.isEmpty());
  }
}

// Focus on specific marker by ID
function focusOn(id: string) {
  if (!map.value) return;
  const m = markersById[id];
  const iw = infoWindowsById[id];
  if (!m) return;
  
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
  if (iw) {
    iw.open({ map: map.value!, anchor: m });
  }
}

// Toggle Airtable markers visibility
function toggleAirtableMarkers() {
  // Re-plot markers
  plotRows(false);
}

// Toggle parcel layer visibility
async function toggleParcels() {
  // Always recompute layers so GP can remain visible when parcels are turned off
  await updateDeckLayers();
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
    map.value.setCenter({ lat: centerLat, lng: centerLng });
    map.value.setZoom(18);

    // Wait for parcels to load, then click on the parcel
    setTimeout(() => {
      const polygon = polygonsByApn[parcelData.apn];
      if (polygon) {
        google.maps.event.trigger(polygon, 'click', {
          latLng: new google.maps.LatLng(centerLat, centerLng)
        });
      }
    }, 2000);

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

defineExpose({ focusOn, focusOnParcel });

onMounted(async () => {
  await ensureMap();

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
    // Use 'idle' event which fires after map movement/zoom settles
    let reloadTimer: number | undefined;

    const handleIdle = () => {
      // Clear existing timer
      if (reloadTimer) clearTimeout(reloadTimer);
      // Slightly longer debounce to reduce thrash
      reloadTimer = window.setTimeout(() => {
        console.log('Map idle, updating deck.gl layers...');
        updateDeckLayers();
      }, 700);
    };

    map.value.addListener('idle', handleIdle);
  }
});

watch(() => props.rows, async (newRows) => {
  if (newRows?.length && map.value) {
    await plotRows();
  }
}, { deep: true });

// When Layton GP is toggled on, lazily build its legend entries (no auto-zoom)
watch(() => showLaytonGeneralPlan.value, async (enabled) => {
  if (enabled) {
    await loadLaytonLegend();
  }
});

</script>

<template>
  <div style="position:relative; width:100%; height:100%;">
    <div ref="mapEl" style="width:100%; height:100%;"></div>


    <!-- Layer List Panel (Right Side, below basemap buttons) -->
    <div style="position:absolute; bottom:auto; top:5rem; right:0.625rem; background:white; padding:1rem 1.25rem; border-radius:0.5rem; box-shadow:0 0.125rem 0.5rem rgba(0,0,0,0.15); z-index:1003; font-family: system-ui, sans-serif; min-width:12rem; max-height:calc(100vh - 12rem); overflow-y:auto;">
      <div style="font-size:0.8125rem; font-weight:700; color:#1f2937; margin-bottom:0.875rem; text-transform:uppercase; letter-spacing:0.03125rem;">
        Layers
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
        <button @click="showDavisSection = !showDavisSection" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:0.5rem 0.75rem; cursor:pointer; font-weight:700; color:#374151;">
          <span>Davis County</span>
          <span>{{ showDavisSection ? '-' : '+' }}</span>
        </button>
        <div v-show="showDavisSection" style="margin-top:0.5rem;">
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

          <!-- Kaysville General Plan Toggle -->
          <label style="display:flex; align-items:center; gap:0.625rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151; padding:0.375rem 0;">
            <input
              type="checkbox"
              v-model="showGeneralPlan"
              @change="updateDeckLayers()"
              style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#7c3aed;"
            />
            <span>Kaysville General Plan</span>
            <button @click.stop="showKaysLegend = !showKaysLegend" style="margin-left:auto; background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.125rem 0.375rem; font-size:0.6875rem; font-weight:700; cursor:pointer;">{{ showKaysLegend ? 'Hide Legend' : 'Show Legend' }}</button>
          </label>
          <div v-if="showKaysLegend && showGeneralPlan" style="margin:0.25rem 0 0.5rem 1.5rem; border:1px solid #e5e7eb; border-radius:8px; padding:0.5rem; max-height:12rem; overflow-y:auto;">
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

          <!-- Layton General Plan Toggle -->
          <label style="display:flex; align-items:center; gap:0.625rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151; padding:0.375rem 0;">
            <input
              type="checkbox"
              v-model="showLaytonGeneralPlan"
              @change="updateDeckLayers()"
              style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#9333ea;"
            />
            <span>Layton General Plan</span>
            <button @click.stop="showLaytonLegend = !showLaytonLegend; if(showLaytonLegend) loadLaytonLegend();" style="margin-left:auto; background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.125rem 0.375rem; font-size:0.6875rem; font-weight:700; cursor:pointer;">{{ showLaytonLegend ? 'Hide Legend' : 'Show Legend' }}</button>
          </label>
          <div v-if="showLaytonLegend && showLaytonGeneralPlan" style="margin:0.25rem 0 0.5rem 1.5rem; border:1px solid #e5e7eb; border-radius:8px; padding:0.5rem; max-height:12rem; overflow-y:auto;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; font-size:0.75rem; font-weight:700; color:#1f2937; margin-bottom:0.375rem; text-transform:uppercase; letter-spacing:0.03125rem;">
              <span>Legend</span>
              <span :style="{background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb', borderRadius:'9999px', padding:'0.125rem 0.5rem', fontSize:'0.6875rem', fontWeight:700}">{{ gpLaytonUsingTiles ? 'Tiles' : 'GeoJSON' }}</span>
            </div>
            <div>
              <div v-if="laytonLegend.length === 0" style="font-size:0.8125rem; color:#6b7280;">Building legend…</div>
              <div v-else>
                <div v-for="item in laytonLegend" :key="item.label" style="display:flex; align-items:center; gap:0.5rem; margin:0.2rem 0;">
                  <span :style="{ width:'14px', height:'14px', borderRadius:'3px', backgroundColor: rgbaToCss(item.color), border: '1px solid #9ca3af', display:'inline-block' }"></span>
                  <span style="font-size:0.8125rem; color:#374151;">{{ item.label }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Embedded Legends inside Layer Panel -->
  </div>

</template>






