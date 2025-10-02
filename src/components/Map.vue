<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { supabase } from '../lib/supabase';

// Type definitions
type ParcelRow = {
  id: number;
  apn: string | null;
  address: string | null;
  city: string | null;
  zip_code: string | null;
  county: string | null;
  owner_type: string | null;
  size_acres: number | null;
  property_url: string | null;
  geojson: { type: 'Polygon' | 'MultiPolygon'; coordinates: any };
};

// Props include Airtable records (id + fields)
const props = defineProps<{ rows: Array<{ id: string; fields: Record<string, any> }> }>();

// Refs
const mapEl = ref<HTMLDivElement | null>(null);
const map = ref<google.maps.Map | null>(null);
const markers: google.maps.Marker[] = [];
const polygons: google.maps.Polygon[] = [];
const markersById: Record<string, google.maps.Marker> = {};
const infoWindowsById: Record<string, google.maps.InfoWindow> = {};
let geocoder: google.maps.Geocoder | null = null;
const cache = new Map<string, google.maps.LatLngLiteral>();
let currentInfoWindow: google.maps.InfoWindow | null = null; // Track currently open info window
const showParcels = ref(true); // Toggle for parcel layer
const parcelLastUpdated = ref('October 2025'); // Last parcel data update

// Airtable IDs from .env
const AIRTABLE_BASE = import.meta.env.VITE_AIRTABLE_BASE as string;
const AIRTABLE_TABLE_ID = import.meta.env.VITE_AIRTABLE_TABLE_ID as string;
const AIRTABLE_VIEW_ID = import.meta.env.VITE_AIRTABLE_VIEW_ID as (string | undefined);

// Load Google Maps API
function loadGoogleMaps(key: string, libraries: string[] = ['places']) {
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
    
    map.value = new google.maps.Map(mapEl.value, {
      center: { lat: 40.7608, lng: -111.8910 },
      zoom: 10,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: true,
    });
    geocoder = new google.maps.Geocoder();
  } catch (error) {
    console.error('Failed to initialize Google Maps:', error);
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

// Fetch parcels from Supabase within current map bounds
async function fetchParcels(bounds?: google.maps.LatLngBounds): Promise<ParcelRow[]> {
  if (!showParcels.value) {
    console.log('Parcel layer is disabled');
    return [];
  }

  try {
    let query = supabase
      .from('parcels')
      .select('id, apn, address, city, zip_code, county, owner_type, size_acres, property_url, geom');

    // If bounds provided, filter by bounding box (for dynamic loading)
    if (bounds) {
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();

      // Use PostGIS ST_Intersects with bounding box
      // Note: This requires a PostGIS function - for now we'll load all and filter client-side
      query = query.limit(500);
    } else {
      query = query.limit(500);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase error:', error);
      return [];
    }

    if (!data) {
      console.log('No parcel data returned from Supabase');
      return [];
    }

    console.log(`Fetched ${data.length} parcels from Supabase`);

    // Transform geom to geojson
    return data.map((row: any) => {
      let geojson = row.geom;

      // If geom is already an object (GeoJSON), use it directly
      if (typeof geojson === 'object' && geojson !== null) {
        // PostGIS returns GeoJSON format
        return {
          ...row,
          geojson: {
            type: geojson.type,
            coordinates: geojson.coordinates
          }
        };
      }

      console.warn('Unexpected geom format for parcel', row.id, typeof geojson);
      return {
        ...row,
        geojson: null
      };
    }).filter((row: ParcelRow) => row.geojson != null);
  } catch (error) {
    console.error('Failed to fetch parcels:', error);
    return [];
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
async function plotRows() {
  if (!map.value) return;
  
  clearMarkers();
  clearPolygons();
  
  const bounds = new google.maps.LatLngBounds();
  let hasPoints = false;

  // 1. Plot Airtable markers (red dots)
  const airtableTasks = props.rows.map(async (r) => {
    const f = r.fields || {};
    const hasLatLng = typeof f.Latitude === 'number' && typeof f.Longitude === 'number';
    const address = f.Address || '';
    const city = f.City ? `, ${f.City}` : '';
    const full = hasLatLng ? '' : `${address}${city}`.trim();

    let pos: google.maps.LatLngLiteral | null = null;
    if (hasLatLng) {
      pos = { lat: f.Latitude, lng: f.Longitude };
    } else if (full) {
      pos = await geocodeOne(full);
    }
    if (!pos) return;

    const m = new google.maps.Marker({
      map: map.value!,
      position: pos,
      title: (f.Name || f.Nickname || address || 'Candidate').toString(),
      icon: { url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' }
    });

    let airtableUrl = '';
    if (AIRTABLE_BASE && AIRTABLE_TABLE_ID) {
      airtableUrl = AIRTABLE_VIEW_ID
        ? `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${AIRTABLE_VIEW_ID}/${r.id}`
        : `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${r.id}`;
    }

    const html = `
      <div style="min-width:340px; line-height:1.8; font-size:16px; font-family: system-ui, -apple-system, sans-serif; font-weight:600; padding:4px;">
        <div style="font-size:13px; color:#dc2626; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px; text-align:center;">
          🔴 AIRTABLE PROPERTY
        </div>
        <div style="font-size:20px; color:#1f2937; margin-bottom:6px; text-align:center;">
          ${f.Name || f.Nickname || 'Candidate'}
        </div>
        <div style="font-size:15px; color:#6b7280; margin-bottom:14px; text-align:center;">${(address || '')} ${city}</div>
        <div style="display:flex; gap:20px; margin-bottom:4px; font-size:16px; justify-content:center;">
          <div><span style="color:#6b7280;">Size:</span> ${f.Size ?? '—'} ac</div>
          <div><span style="color:#6b7280;">Price:</span> ${f.Price ?? '—'}</div>
        </div>
        ${airtableUrl ? `<div style="margin-top:14px; padding-top:14px; border-top:1px solid #e5e7eb; text-align:center;">
          <a href="${airtableUrl}" target="_blank" rel="noopener" style="color:#2563eb; text-decoration:none; font-size:15px;">
            Open in Airtable →
          </a>
        </div>` : ''}
      </div>`;

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
  });

  // 2. Plot Supabase parcels (blue polygons)
  const parcelTask = (async () => {
    console.log('Starting to fetch parcels...');
    const parcels = await fetchParcels();
    console.log(`Processing ${parcels.length} parcels for display`);

    for (const p of parcels) {
      const paths = toPaths(p.geojson);
      console.log(`Parcel ${p.apn}: paths=${paths.length}`);
      if (paths.length === 0) {
        console.warn('No paths generated for parcel', p.apn, p.geojson);
        continue;
      }

      const polygon = new google.maps.Polygon({
        paths,
        map: map.value!,
        fillColor: '#2563eb',
        fillOpacity: 0.15,
        strokeColor: '#1e40af',
        strokeWeight: 2,
      });

      // Extend bounds to include all points in all paths
      for (const path of paths) {
        for (const pt of path) {
          bounds.extend(pt);
          hasPoints = true;
        }
      }

      console.log(`Created polygon for parcel ${p.apn} at bounds`, paths[0]?.[0]);

      polygon.addListener('click', (e: google.maps.MapMouseEvent) => {
        const cityState = p.city ? `${p.city}, ${p.county} County` : (p.county ? `${p.county} County` : '');
        const html = `
          <div style="min-width:360px; line-height:1.8; font-size:16px; font-family: system-ui, -apple-system, sans-serif; font-weight:600; padding:4px;">
            <div style="font-size:13px; color:#2563eb; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px; text-align:center;">
              🔷 PARCEL (SUPABASE)
            </div>
            <div style="font-size:20px; color:#1f2937; margin-bottom:6px; text-align:center;">
              ${p.address || 'No Address'}
            </div>
            ${cityState ? `<div style="font-size:15px; color:#6b7280; margin-bottom:3px; text-align:center;">${cityState}</div>` : ''}
            ${p.zip_code ? `<div style="font-size:15px; color:#6b7280; margin-bottom:14px; text-align:center;">ZIP: ${p.zip_code}</div>` : ''}
            <div style="display:grid; grid-template-columns: auto 1fr; gap:10px 16px; margin-bottom:4px; font-size:16px; max-width:300px; margin-left:auto; margin-right:auto;">
              <span style="color:#6b7280;">APN:</span>
              <span>${p.apn || '—'}</span>

              <span style="color:#6b7280;">Size:</span>
              <span>${p.size_acres != null ? p.size_acres.toFixed(2) : '—'} acres</span>

              <span style="color:#6b7280;">Owner:</span>
              <span>${p.owner_type || '—'}</span>
            </div>
            <div style="margin-top:14px; padding-top:14px; border-top:1px solid #e5e7eb; text-align:center;">
              <a href="https://parcels.utah.gov/?parcelid=${encodeURIComponent(p.apn || '')}" target="_blank" rel="noopener" style="color:#2563eb; text-decoration:none; font-size:15px; display:block; margin-bottom:8px;">
                View on Utah Parcels →
              </a>
              <a href="https://webportal.daviscountyutah.gov/App/PropertySearch/esri/map" target="_blank" rel="noopener" style="color:#2563eb; text-decoration:none; font-size:14px;">
                Search on Davis County (APN: ${p.apn}) →
              </a>
            </div>
          </div>`;

        const iw = new google.maps.InfoWindow({ content: html });

        // Close any previously open info window
        if (currentInfoWindow) {
          currentInfoWindow.close();
        }

        if (e.latLng) {
          iw.setPosition(e.latLng);
        }
        iw.open({ map: map.value! });
        currentInfoWindow = iw;
      });

      polygons.push(polygon);
    }
  })();

  await Promise.allSettled([...airtableTasks, parcelTask]);

  if (hasPoints && !bounds.isEmpty()) {
    console.log('Fitting map to bounds:', bounds.toJSON());
    map.value.fitBounds(bounds);
  } else {
    console.warn('No points to fit bounds to. hasPoints:', hasPoints, 'isEmpty:', bounds.isEmpty());
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

// Toggle parcel layer visibility
function toggleParcels() {
  if (showParcels.value) {
    // Re-plot to show parcels
    plotRows();
  } else {
    // Clear parcels
    clearPolygons();
  }
}

defineExpose({ focusOn });

onMounted(async () => {
  await ensureMap();
  if (props.rows?.length) {
    await plotRows();
  }
});

watch(() => props.rows, async (newRows) => {
  if (newRows?.length && map.value) {
    await plotRows();
  }
}, { deep: true });
</script>

<template>
  <div style="position:relative; width:100%; height:100%;">
    <div ref="mapEl" style="width:100%; height:100%; border:1px solid #ddd; border-radius:12px;"></div>

    <!-- Parcel Layer Controls -->
    <div style="position:absolute; top:10px; left:10px; background:white; padding:12px 16px; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.15); z-index:1000; font-family: system-ui, sans-serif;">
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:14px; font-weight:600;">
        <input
          type="checkbox"
          v-model="showParcels"
          @change="toggleParcels"
          style="width:16px; height:16px; cursor:pointer;"
        />
        <span>Show Parcels</span>
      </label>
      <div v-if="showParcels" style="font-size:12px; color:#6b7280; margin-top:4px; margin-left:24px;">
        Updated: {{ parcelLastUpdated }}
      </div>
    </div>
  </div>
</template>