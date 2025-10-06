<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

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
const showParcels = ref(false); // Toggle for parcel layer (start disabled)
const parcelLastUpdated = ref('October 2025'); // Last parcel data update

// Airtable IDs from .env
const AIRTABLE_BASE = import.meta.env.VITE_AIRTABLE_BASE as string;
const AIRTABLE_TABLE_ID = import.meta.env.VITE_AIRTABLE_TABLE_ID as string;
const AIRTABLE_VIEW_ID = import.meta.env.VITE_AIRTABLE_VIEW_ID as (string | undefined);
const AIRTABLE_API_KEY = import.meta.env.VITE_AIRTABLE_TOKEN as string;

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
    });

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
      mapTypeControl: true, // Re-enable default map type controls
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
  const MIN_ZOOM = 11; // Adjust this value (higher = need to zoom in more)

  if (zoom < MIN_ZOOM) {
    console.log(`⚠️ Zoom level ${zoom} too low. Zoom to ${MIN_ZOOM}+ to see parcels.`);
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
    console.log(`✅ Fetched ${parcels.length} parcels from Supabase in ${Math.round(endTime - startTime)}ms`);

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

  // 1. Plot Airtable markers (red dots)
  const airtableTasks = props.rows.map(async (r) => {
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

    const html = `
      <div style="min-width:21.25rem; line-height:1.8; font-size:1rem; font-family: system-ui, -apple-system, sans-serif; font-weight:600; padding:0.5rem;">
        <div style="font-size:0.8125rem; color:#dc2626; text-transform:uppercase; letter-spacing:0.03125rem; margin-bottom:0.75rem; text-align:center;">
          🔴 AIRTABLE PROPERTY
        </div>
        <div style="font-size:1.25rem; color:#1f2937; margin-bottom:0.5rem; text-align:center;">
          ${f.Name || f.Nickname || 'Candidate'}
        </div>
        <div style="font-size:0.9375rem; color:#6b7280; margin-bottom:1rem; text-align:center;">${propertyAddress || ''} ${city}</div>
        <div style="display:flex; gap:1.25rem; margin-bottom:0.5rem; font-size:1rem; justify-content:center;">
          <div><span style="color:#6b7280;">Size:</span> ${f['Size (acres)'] ?? f.Size ?? '—'} ac</div>
          <div><span style="color:#6b7280;">Price:</span> ${f.Price ?? '—'}</div>
        </div>
        ${airtableUrl ? `<div style="margin-top:1rem; padding-top:1rem; border-top:1px solid #e5e7eb; text-align:center;">
          <a href="${airtableUrl}" target="_blank" rel="noopener" style="color:#2563eb; text-decoration:none; font-size:0.9375rem;">
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

  // 2. Plot parcels from Utah API (blue polygons)
  const parcelTask = (async () => {
    console.log('Starting to fetch parcels from Utah API...');
    console.log('showParcels.value:', showParcels.value);

    // Get current map bounds to filter parcels
    const currentBounds = map.value?.getBounds();
    const parcels = await fetchParcels(currentBounds);
    console.log(`Processing ${parcels.length} parcels for display`);

    for (const p of parcels) {
      // Skip parcels without APN
      if (!p.apn) continue;

      // Skip if this parcel is already displayed
      if (polygonsByApn[p.apn]) {
        continue;
      }

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

      // Track this polygon by APN
      polygons.push(polygon);
      polygonsByApn[p.apn] = polygon;

      polygon.addListener('click', (e: google.maps.MapMouseEvent) => {
        // Create a unique ID for this parcel's button
        const buttonId = `add-to-airtable-${p.id}`;

        const html = `
          <div style="min-width:23.75rem; line-height:1.8; font-size:1rem; font-family: system-ui, -apple-system, sans-serif; font-weight:600; padding:0.5rem;">
            <div style="font-size:0.8125rem; color:#2563eb; text-transform:uppercase; letter-spacing:0.03125rem; margin-bottom:0.75rem; text-align:center;">
              🔷 DAVIS COUNTY PARCEL
            </div>
            <div style="font-size:1.25rem; color:#1f2937; margin-bottom:0.5rem; text-align:center;">
              ${p.address || 'No Property Address'}
            </div>
            <div style="font-size:0.875rem; color:#6b7280; margin-bottom:1rem; text-align:center;">
              ${p.county} County
            </div>

            ${p.owner_name ? `
              <div style="background:#f3f4f6; padding:0.75rem; border-radius:0.375rem; margin-bottom:0.875rem;">
                <div style="font-size:0.875rem; color:#6b7280; margin-bottom:0.375rem;">OWNER INFORMATION</div>
                <div style="font-size:1rem; color:#1f2937;">${p.owner_name}</div>
                ${p.owner_address ? `<div style="font-size:0.875rem; color:#6b7280; margin-top:0.25rem;">${p.owner_address}</div>` : ''}
                ${p.city || p.zip_code ? `<div style="font-size:0.875rem; color:#6b7280;">${p.city || ''}${p.city && p.zip_code ? ', ' : ''}${p.zip_code || ''}</div>` : ''}
              </div>
            ` : ''}

            <div style="display:grid; grid-template-columns: auto 1fr; gap:0.75rem 1rem; margin-bottom:0.5rem; font-size:1rem; max-width:20rem; margin-left:auto; margin-right:auto;">
              <span style="color:#6b7280;">APN:</span>
              <span>${p.apn || '—'}</span>

              <span style="color:#6b7280;">Size:</span>
              <span>${p.size_acres != null ? p.size_acres.toFixed(2) : '—'} acres</span>
            </div>

            <div style="margin-top:1rem; padding-top:1rem; border-top:1px solid #e5e7eb;">
              <button
                id="${buttonId}"
                style="width:100%; background:#000000; color:white; border:none; padding:0.75rem 1.25rem; border-radius:0.5rem; font-size:0.9375rem; font-weight:600; cursor:pointer; margin-bottom:0.875rem; transition: background 0.2s;"
                onmouseover="this.style.background='#333333'"
                onmouseout="this.style.background='#000000'"
              >
                ➕ Add to Land Database
              </button>

              <a href="https://parcels.utah.gov/?parcelid=${encodeURIComponent(p.apn || '')}" target="_blank" rel="noopener" style="color:#2563eb; text-decoration:none; font-size:0.9375rem; display:block; margin-bottom:0.625rem; text-align:center;">
                View on Utah Parcels →
              </a>
              <a href="https://webportal.daviscountyutah.gov/App/PropertySearch/esri/map" target="_blank" rel="noopener" style="color:#2563eb; text-decoration:none; font-size:0.875rem; display:block; text-align:center;">
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

        // Add click listener to the button after InfoWindow is rendered
        google.maps.event.addListenerOnce(iw, 'domready', () => {
          const button = document.getElementById(buttonId);
          if (button) {
            button.addEventListener('click', () => {
              addParcelToAirtable(p);
            });
          }
        });
      });

      polygons.push(polygon);
    }
  })();

  await Promise.allSettled([...airtableTasks, parcelTask]);

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

// Toggle parcel layer visibility
function toggleParcels() {
  if (showParcels.value) {
    // Re-plot to show parcels, but don't auto-fit bounds
    plotRows(false);
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

  // Add listener to reload parcels when map moves or zooms (if parcels are enabled)
  if (map.value) {
    // Debounce the reload to avoid too many requests
    let reloadTimer: number | undefined;

    const handleMapChange = () => {
      if (!showParcels.value) return;

      // Clear existing timer
      if (reloadTimer) clearTimeout(reloadTimer);

      // Wait 500ms after user stops moving/zooming before reloading
      reloadTimer = window.setTimeout(() => {
        console.log('Map viewport changed, reloading parcels...');
        plotRows(false);
      }, 500);
    };

    map.value.addListener('bounds_changed', handleMapChange);
    map.value.addListener('zoom_changed', handleMapChange);
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
    <div ref="mapEl" style="width:100%; height:100%;"></div>

    <!-- Layer List Panel (Right Side, below basemap buttons) -->
    <div style="position:absolute; bottom:auto; top:5rem; right:0.625rem; background:white; padding:1rem 1.25rem; border-radius:0.5rem; box-shadow:0 0.125rem 0.5rem rgba(0,0,0,0.15); z-index:1003; font-family: system-ui, sans-serif; min-width:12rem;">
      <div style="font-size:0.8125rem; font-weight:700; color:#1f2937; margin-bottom:0.875rem; text-transform:uppercase; letter-spacing:0.03125rem;">
        Layers
      </div>

      <!-- Parcel Layer Toggle -->
      <label style="display:flex; align-items:center; gap:0.625rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151; padding:0.375rem 0;">
        <input
          type="checkbox"
          v-model="showParcels"
          @change="toggleParcels"
          style="width:1.125rem; height:1.125rem; cursor:pointer; accent-color:#2563eb;"
        />
        <span>Davis County Parcels</span>
      </label>
    </div>
  </div>
</template>