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

// Fetch parcels from Supabase
async function fetchParcels(): Promise<ParcelRow[]> {
  try {
    const { data, error } = await supabase
      .from('parcels')
      .select('id, apn, address, city, zip_code, county, owner_type, size_acres, property_url, geom')
      .limit(100);

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
      <div style="min-width:240px; line-height:1.5;">
        <strong style="color:#dc2626;">🔴 Airtable Property</strong><br/>
        <strong>${f.Name || f.Nickname || 'Candidate'}</strong><br/>
        ${(address || '')} ${city}<br/>
        <div>Size: ${f.Size ?? '—'} ac</div>
        <div>Price: ${f.Price ?? '—'}</div>
        ${airtableUrl ? `<div style="margin-top:8px;">
          <a href="${airtableUrl}" target="_blank" rel="noopener" style="color:#2563eb;">Open in Airtable ↗</a>
        </div>` : ''}
      </div>`;

    const iw = new google.maps.InfoWindow({ content: html });
    m.addListener('click', () => iw.open({ map: map.value!, anchor: m }));
    
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
          <div style="min-width:260px; line-height:1.5;">
            <strong style="color:#2563eb;">🔷 Parcel (Supabase)</strong><br/>
            <strong>${p.address || 'No Address'}</strong><br/>
            ${cityState ? `<div style="color:#666;">${cityState}</div>` : ''}
            ${p.zip_code ? `<div style="color:#666;">ZIP: ${p.zip_code}</div>` : ''}
            <hr style="margin:8px 0; border:none; border-top:1px solid #ddd;"/>
            <div><strong>APN:</strong> ${p.apn || '—'}</div>
            <div><strong>Size:</strong> ${p.size_acres != null ? p.size_acres.toFixed(2) : '—'} acres</div>
            <div><strong>Owner Type:</strong> ${p.owner_type || '—'}</div>
            ${p.property_url ? `<div style="margin-top:8px;">
              <a href="${p.property_url}" target="_blank" rel="noopener" style="color:#2563eb;">View County Records ↗</a>
            </div>` : ''}
          </div>`;

        const iw = new google.maps.InfoWindow({ content: html });
        if (e.latLng) {
          iw.setPosition(e.latLng);
        }
        iw.open({ map: map.value! });
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
  <div ref="mapEl" style="width:100%; height:100%; border:1px solid #ddd; border-radius:12px;"></div>
</template>