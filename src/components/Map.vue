<script setup lang="ts">
import { onMounted, ref, watchEffect } from 'vue';

// Props include Airtable records (id + fields)
const props = defineProps<{ rows: Array<{ id: string; fields: Record<string, any> }> }>();

const mapEl = ref<HTMLDivElement | null>(null);
const map = ref<google.maps.Map | null>(null);
const markers: google.maps.Marker[] = [];
const markersById: Record<string, google.maps.Marker> = {};
const infoWindowsById: Record<string, google.maps.InfoWindow> = {};
let geocoder: google.maps.Geocoder | null = null;
const cache = new Map<string, google.maps.LatLngLiteral>();

// Airtable IDs from .env
const AIRTABLE_BASE = import.meta.env.VITE_AIRTABLE_BASE as string; // app...
const AIRTABLE_TABLE_ID = import.meta.env.VITE_AIRTABLE_TABLE_ID as string; // tbl...
const AIRTABLE_VIEW_ID = import.meta.env.VITE_AIRTABLE_VIEW_ID as (string | undefined);

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
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
}

async function ensureMap() {
  const key = import.meta.env.VITE_GOOGLE_MAPS_KEY as string;
  if (!key) throw new Error('Missing VITE_GOOGLE_MAPS_KEY in .env');

  await loadGoogleMaps(key);
  map.value = new google.maps.Map(mapEl.value as HTMLDivElement, {
    center: { lat: 40.7608, lng: -111.8910 },
    zoom: 8,
    streetViewControl: false,
    fullscreenControl: false,
    mapTypeControl: false,
  });
  geocoder = new google.maps.Geocoder();
}

function clearMarkers() { for (const m of markers) m.setMap(null); markers.length = 0; }

async function geocodeOne(addr: string) {
  if (!geocoder) return null;
  if (cache.has(addr)) return cache.get(addr)!;

  // geocoder.geocode uses a callback-style API; wrap it in a Promise so we can await it
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
    // swallow geocode errors - return null so the caller will skip this record
    console.warn('Geocode failed for', addr, e);
  }

  return null;
}

async function plotRows() {
  if (!map.value) return;
  clearMarkers();
  const bounds = new google.maps.LatLngBounds();
  const jobs: Promise<void>[] = [];

  for (const r of props.rows) {
    const f = r.fields || {};
    const hasLatLng = typeof f.Latitude === 'number' && typeof f.Longitude === 'number';
    const address = f.Address || '';
    const city = f.City ? `, ${f.City}` : '';
    const full = hasLatLng ? '' : `${address}${city}`.trim();

    const task = (async () => {
      let pos: google.maps.LatLngLiteral | null = null;
      if (hasLatLng) pos = { lat: f.Latitude, lng: f.Longitude };
      else if (full) pos = await geocodeOne(full);
      if (!pos) return;

      const m = new google.maps.Marker({
        map: map.value!,
        position: pos,
        title: (f.Name || f.Nickname || address || 'Candidate').toString(),
      });

      // Build a safe Airtable record URL. Requires TABLE ID; VIEW ID is optional.
      let airtableUrl = '';
      if (AIRTABLE_BASE && AIRTABLE_TABLE_ID) {
        airtableUrl = AIRTABLE_VIEW_ID
          ? `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${AIRTABLE_VIEW_ID}/${r.id}`
          : `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLE_ID}/${r.id}`;
      }

      const recTitle = (f.Name || f.Nickname || 'Candidate');
      const html = `\
        <div style="min-width:240px; line-height:1.25;">\
          <strong>${recTitle}</strong><br/>\
          ${(address || '')} ${city}<br/>\
          <div>Size: ${f.Size ?? '\\u2014'} ac</div>\
          <div>Price: ${f.Price ?? '\\u2014'}</div>\
          <div>Stage/TAGS: ${f.Stage ?? f.TAGS ?? '\\u2014'}</div>\
          ${airtableUrl ? `<div style="margin-top:8px;">\
            <a href="${airtableUrl}" target="_blank" rel="noopener">Open in Airtable \\u2197</a>\
          </div>` : ''}\
        </div>`;

      const iw = new google.maps.InfoWindow({ content: html });
      m.addListener('click', () => iw.open({ map: map.value!, anchor: m }));
      markers.push(m);
      markersById[r.id] = m;
      infoWindowsById[r.id] = iw;
      bounds.extend(pos);
    })();

    jobs.push(task);
  }

  await Promise.allSettled(jobs);
  if (!bounds.isEmpty()) map.value.fitBounds(bounds);
}

function focusOn(id: string) {
  if (!map.value) return;
  const m = markersById[id];
  const iw = infoWindowsById[id];
  if (!m) return;
  const pos = m.getPosition?.();
  if (pos) {
    const latlng = pos.toJSON ? pos.toJSON() : { lat: (pos as any).lat(), lng: (pos as any).lng() };
    try { map.value.panTo(latlng); } catch (e) { /* ignore */ }
  }
  if (iw) iw.open({ map: map.value!, anchor: m });
}

// expose focusOn to parent components via ref (script setup)
defineExpose({ focusOn });

onMounted(async () => { await ensureMap(); await plotRows(); });
watchEffect(() => { if (props.rows?.length && map.value) plotRows(); });
</script>

<template>
  <div ref="mapEl" style="width:100%; height:600px; border:1px solid #ddd; border-radius:12px;"></div>
</template>
