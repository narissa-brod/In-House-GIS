<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { fetchAllAirtable, type AirtableRecord } from './lib/airtable';
import Map from './components/Map.vue';

const loading = ref(true);
const error = ref<string | null>(null);
const rows = ref<AirtableRecord[]>([]);
const mapRef = ref<InstanceType<typeof Map> | null>(null);
let timer: number | undefined;

// Filter options - arrays for multiple selections
const selectedCities = ref<string[]>([]);
const selectedPrices = ref<string[]>([]);
const selectedTags = ref<string[]>([]);

// Filters panel dropdown state
const showLandFilterSection = ref(false);
const showGpFilterSection = ref(false);
const showParcelSearchSection = ref(false);

// Parcel search filters (local state, synced via computed)
const parcelSearchPropClass = computed({
  get: () => mapRef.value?.searchFilters?.propClass || [],
  set: (val) => { if (mapRef.value?.searchFilters) mapRef.value.searchFilters.propClass = val; }
});
const parcelSearchMinAcres = computed({
  get: () => mapRef.value?.searchFilters?.minAcres,
  set: (val) => { if (mapRef.value?.searchFilters) mapRef.value.searchFilters.minAcres = val ?? null; }
});
const parcelSearchMaxAcres = computed({
  get: () => mapRef.value?.searchFilters?.maxAcres,
  set: (val) => {
    if (mapRef.value?.searchFilters) {
      mapRef.value.searchFilters.maxAcres = val ?? null;
    }
  }
});
const parcelSearchMinValue = computed({
  get: () => mapRef.value?.searchFilters?.minValue ?? null,
  set: (val) => {
    if (mapRef.value?.searchFilters) {
      mapRef.value.searchFilters.minValue = val ?? null;
    }
  }
});
const parcelSearchMaxValue = computed({
  get: () => mapRef.value?.searchFilters?.maxValue ?? null,
  set: (val) => { if (mapRef.value?.searchFilters) mapRef.value.searchFilters.maxValue = val ?? null; }
});
const parcelSearchCities = computed({
  get: () => mapRef.value?.searchFilters?.cities || [],
  set: (val) => { if (mapRef.value?.searchFilters) mapRef.value.searchFilters.cities = val; }
});

// Filter panel always visible (collapse removed)

async function loadData() {
  loading.value = true;
  error.value = null;
  try {
    const data = await fetchAllAirtable();
    rows.value = data;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadData();
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});

// Get unique cities from data
const cities = computed(() => {
  const citySet = new Set<string>();
  rows.value.forEach(r => {
    const city = r.fields?.City;
    if (city) citySet.add(city.toString());
  });
  return Array.from(citySet).sort();
});

// Get unique tags from data
const tags = computed(() => {
  const tagSet = new Set<string>();
  rows.value.forEach(r => {
    const tag = r.fields?.TAGS;
    if (tag) tagSet.add(tag.toString());
  });
  return Array.from(tagSet).sort();
});

// Apply filters with checkbox arrays
const filtered = computed(() => {
  return rows.value.filter(r => {
    const f = r.fields || {};

    // City filter - show if no cities selected OR city matches one of selected
    if (selectedCities.value.length > 0) {
      const city = f.City?.toString();
      if (!city || !selectedCities.value.includes(city)) {
        return false;
      }
    }

    // Price filter - show if no prices selected OR price matches one of selected ranges
    if (selectedPrices.value.length > 0) {
      const price = parseFloat(f.Price?.toString().replace(/[^0-9.]/g, '') || '0');
      let matchesPrice = false;

      if (selectedPrices.value.includes('under100k') && price < 100000) matchesPrice = true;
      if (selectedPrices.value.includes('100k-500k') && price >= 100000 && price < 500000) matchesPrice = true;
      if (selectedPrices.value.includes('over500k') && price >= 500000) matchesPrice = true;

      if (!matchesPrice) return false;
    }

    // Tag filter - show if no tags selected OR tag matches one of selected
    if (selectedTags.value.length > 0) {
      const tag = f.TAGS?.toString();
      if (!tag || !selectedTags.value.includes(tag)) {
        return false;
      }
    }

    return true;
  });
});

// Unified General Plan filters (checkbox model) — combine cities
const gpChecks = ref<Record<string, boolean>>({});

// Build a marker city checks map for Map.vue (true for selected or all if none)
const markerCityChecksForMap = computed<Record<string, boolean>>(() => {
  const map: Record<string, boolean> = {};
  cities.value.forEach(c => { map[c] = selectedCities.value.length === 0 ? true : selectedCities.value.includes(c); });
  return map;
});

function focusRow(id: string) {
  mapRef.value?.focusOn(id);
}
</script>

<template>
  <main :style="{
    padding: '0',
    margin: '0',
    height: '100vh',
    overflow: 'hidden',
    width: '100vw'
  }">
    <div v-if="loading" style="display:flex; align-items:center; justify-content:center; height:100vh;">
      <p>Loading…</p>
    </div>
    <div v-else-if="error" style="display:flex; align-items:center; justify-content:center; height:100vh; color:red;">
      <p>Error: {{ error }}</p>
    </div>

    <div v-if="!loading && !error" style="position:relative; width:100vw; height:100vh;">
      <!-- Map Container (Full Screen) -->
      <div style="position:absolute; top:0; left:0; right:0; bottom:0; width:100%; height:100%;">
        <Map ref="mapRef" :rows="filtered" :gpChecks="gpChecks" :markerCityChecks="markerCityChecksForMap" :style="{ height: '100%', width: '100%' }" />
      </div>

      <!-- Filter Panel (Left Side) - On top of map -->
      <div class="cw-ui" style="position:absolute; top:5rem; left:0.625rem; background:white; padding:1rem 1.25rem; border-radius:0.5rem; box-shadow:0 0.125rem 0.5rem rgba(0,0,0,0.15); z-index:1003; min-width:14rem; max-width:18rem; max-height:calc(100vh - 12rem); overflow-y:auto;">
        <div style="font-size:0.8125rem; font-weight:700; color:#1f2937; margin-bottom:0.5rem; text-transform:uppercase; letter-spacing:0.03125rem;">Filters</div>

                <!-- Parcel Search (dropdown) -->
        <div style="margin-bottom:0.5rem;">
          <button @click="showParcelSearchSection = !showParcelSearchSection" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:0.5rem 0.75rem; cursor:pointer; font-weight:500; color:#374151; text-transform:uppercase; letter-spacing:0.05em; font-size:0.8125rem;">
            <span>Parcel Search</span>
            <span>{{ showParcelSearchSection ? '-' : '+' }}</span>
          </button>
          <div v-show="showParcelSearchSection" style="margin-top:0.5rem; display:flex; flex-direction:column; gap:0.75rem;">
            <!-- Property Class (checkboxes) -->
            <div>
              <div style="display:block; font-size:0.75rem; color:#6b7280; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03rem;">Property Class</div>
              <div style="display:grid; grid-template-columns: 1fr; gap:0.375rem;">
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchPropClass" :value="'Commercial'" />
                  <span>Commercial</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchPropClass" :value="'Commercial - Apartment & Condo'" />
                  <span>Commercial - Apartment & Condo</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchPropClass" :value="'Commercial - Office Space'" />
                  <span>Commercial - Office Space</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchPropClass" :value="'Residential'" />
                  <span>Residential</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchPropClass" :value="'Vacant'" />
                  <span>Vacant</span>
                </label>
              </div>
            </div>

            <!-- Acreage (short inputs) -->
            <div>
              <div style="display:block; font-size:0.75rem; color:#6b7280; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03rem;">Acreage</div>
              <div style="display:flex; gap:0.375rem; align-items:center;">
                <input type="number" v-model.number="parcelSearchMinAcres" placeholder="Min" step="0.1" style="width:4rem; padding:0.375rem; border:1px solid #d1d5db; border-radius:4px; font-size:0.75rem;">
                <span style="color:#9ca3af; font-size:0.75rem;">to</span>
                <input type="number" v-model.number="parcelSearchMaxAcres" placeholder="Max" step="0.1" style="width:4rem; padding:0.375rem; border:1px solid #d1d5db; border-radius:4px; font-size:0.75rem;">
              </div>
            </div>

            <!-- Market Value (short inputs) -->
            <div>
              <div style="display:block; font-size:0.75rem; color:#6b7280; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03rem;">Market Value</div>
              <div style="display:flex; gap:0.375rem; align-items:center;">
                <input type="number" v-model.number="parcelSearchMinValue" placeholder="Min $" step="10000" style="width:6.5rem; padding:0.375rem; border:1px solid #d1d5db; border-radius:4px; font-size:0.75rem;">
                <span style="color:#9ca3af; font-size:0.75rem;">to</span>
                <input type="number" v-model.number="parcelSearchMaxValue" placeholder="Max $" step="10000" style="width:6.5rem; padding:0.375rem; border:1px solid #d1d5db; border-radius:4px; font-size:0.75rem;">
              </div>
            </div>

            <!-- Building Status removed to avoid over-filtering and false negatives -->

            <!-- City (checkboxes) -->
            <div>
              <div style="display:block; font-size:0.75rem; color:#6b7280; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03rem;">City</div>
              <div style="display:grid; grid-template-columns: 1fr; gap:0.3rem; max-height:10rem; overflow:auto; border:1px solid #e5e7eb; border-radius:6px; padding:0.5rem;">
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'BOUNTIFUL'" />
                  <span>Bountiful</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'CENTERVILLE'" />
                  <span>Centerville</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'CLEARFIELD'" />
                  <span>Clearfield</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'CLINTON'" />
                  <span>Clinton</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'FARMINGTON'" />
                  <span>Farmington</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'FRUIT HEIGHTS'" />
                  <span>Fruit Heights</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'KAYSVILLE'" />
                  <span>Kaysville</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'LAYTON'" />
                  <span>Layton</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'NORTH SALT LAKE'" />
                  <span>North Salt Lake</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'SOUTH WEBER'" />
                  <span>South Weber</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'SUNSET'" />
                  <span>Sunset</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'SYRACUSE'" />
                  <span>Syracuse</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'WEST BOUNTIFUL'" />
                  <span>West Bountiful</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'WEST POINT'" />
                  <span>West Point</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:#374151;">
                  <input type="checkbox" v-model="parcelSearchCities" :value="'WOODS CROSS'" />
                  <span>Woods Cross</span>
                </label>
              </div>
            </div>

            <!-- Action Buttons -->
            <div style="display:flex; gap:0.375rem;">
              <button @click="mapRef?.executeParcelSearch()" :disabled="mapRef?.isSearching" style="flex:1; padding:0.5rem; background:#2563eb; color:white; border:none; border-radius:4px; font-size:0.75rem; font-weight:600; cursor:pointer; transition:background 0.2s;" :style="{ opacity: mapRef?.isSearching ? 0.6 : 1, cursor: mapRef?.isSearching ? 'not-allowed' : 'pointer' }">
                {{ mapRef?.isSearching ? 'Searching...' : 'Search' }}
              </button>
              <button @click="mapRef?.zoomToSearchResults()" :disabled="!mapRef?.searchResults || (mapRef?.searchResults?.length || 0) === 0" style="flex:0.7; padding:0.5rem; background:#f3f4f6; color:#2563eb; border:1px solid #bfdbfe; border-radius:4px; font-size:0.75rem; font-weight:600; cursor:pointer;">
                Zoom
              </button>
              <button @click="mapRef?.clearSearchFilters()" style="flex:0.5; padding:0.5rem; background:#f3f4f6; color:#6b7280; border:none; border-radius:4px; font-size:0.75rem; font-weight:600; cursor:pointer;">
                Clear
              </button>
            </div>

            <!-- Search Results Summary -->
            <div v-if="mapRef?.searchResults && mapRef.searchResults.length > 0" style="background:#fef3c7; border:1px solid #fde68a; border-radius:4px; padding:0.5rem;">
              <div style="font-size:0.75rem; font-weight:600; color:#92400e; margin-bottom:0.375rem;">Found {{ mapRef.searchResults.length }} parcels</div>
              <div style="font-size:0.625rem; color:#78350f;">Highlighted in orange on map</div>
              <div style="display:flex; gap:0.375rem; margin-top:0.5rem;">
                <button @click="mapRef?.exportSearchResults()" style="flex:1; padding:0.375rem; background:#16a34a; color:white; border:none; border-radius:4px; font-size:0.625rem; font-weight:600; cursor:pointer;">
                  Export CSV
                </button>
                <button @click="mapRef?.handleClearSearchResults()" style="flex:0.5; padding:0.375rem; background:#dc2626; color:white; border:none; border-radius:4px; font-size:0.625rem; font-weight:600; cursor:pointer;">
                  Clear
                </button>
              </div>
            </div>

            <!-- Error Message -->
            <div v-if="mapRef?.searchError" style="background:#fee2e2; border:1px solid #fecaca; border-radius:4px; padding:0.5rem; font-size:0.625rem; color:#991b1b;">
              {{ mapRef.searchError }}
            </div>
          </div>
        </div>

        <!-- Land Database (dropdown) -->
        <div style="margin-bottom:0.5rem;">
          <button @click="showLandFilterSection = !showLandFilterSection" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:0.5rem 0.75rem; cursor:pointer; font-weight:500; color:#374151; text-transform:uppercase; letter-spacing:0.05em; font-size:0.8125rem;">
            <span>Land Database</span>
            <span>{{ showLandFilterSection ? '-' : '+' }}</span>
          </button>
          <div v-show="showLandFilterSection" style="margin-top:0.5rem;">
            <!-- City Filter -->
            <div style="margin-bottom:0.75rem;">
              <div style="display:block; font-size:0.75rem; color:#6b7280; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03rem;">City</div>
              <div style="display:flex; flex-direction:column; gap:0.375rem;">
                <label v-for="city in cities" :key="city" style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151;">
                  <input type="checkbox" :value="city" v-model="selectedCities" style="width:1rem; height:1rem; cursor:pointer; accent-color:#2563eb;" />
                  <span>{{ city }}</span>
                </label>
              </div>
            </div>

            <!-- Price Filter -->
            <div style="margin-bottom:0.75rem;">
              <div style="display:block; font-size:0.75rem; color:#6b7280; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03rem;">Price</div>
              <div style="display:flex; flex-direction:column; gap:0.375rem;">
                <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151;">
                  <input type="checkbox" value="under100k" v-model="selectedPrices" style="width:1rem; height:1rem; cursor:pointer; accent-color:#2563eb;" />
                  <span>Under $100k</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151;">
                  <input type="checkbox" value="100k-500k" v-model="selectedPrices" style="width:1rem; height:1rem; cursor:pointer; accent-color:#2563eb;" />
                  <span>$100k - $500k</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151;">
                  <input type="checkbox" value="over500k" v-model="selectedPrices" style="width:1rem; height:1rem; cursor:pointer; accent-color:#2563eb;" />
                  <span>Over $500k</span>
                </label>
              </div>
            </div>

            <!-- Tag Filter -->
            <div style="margin-bottom:0.5rem;">
              <div style="display:block; font-size:0.75rem; color:#6b7280; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03rem;">Tags</div>
              <div style="display:flex; flex-direction:column; gap:0.375rem;">
                <label v-for="tag in tags" :key="tag" style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151;">
                  <input type="checkbox" :value="tag" v-model="selectedTags" style="width:1rem; height:1rem; cursor:pointer; accent-color:#2563eb;" />
                  <span>{{ tag }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- General Plan (dropdown) -->
        <div style="margin-bottom:0.5rem;">
          <button @click="showGpFilterSection = !showGpFilterSection" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:0.5rem 0.75rem; cursor:pointer; font-weight:500; color:#374151; text-transform:uppercase; letter-spacing:0.05em; font-size:0.8125rem;">
            <span>General Plan</span>
            <span>{{ showGpFilterSection ? '-' : '+' }}</span>
          </button>
          <div v-show="showGpFilterSection" style="margin-top:0.5rem;">
            <div style="font-size:0.6875rem; color:#6b7280; margin-bottom:0.25rem; text-transform:uppercase; letter-spacing:0.06em;">Categories (All Cities)</div>
            <div style="display:flex; flex-direction:column; gap:0.25rem;">
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['single family residential']" /> <span>Single Family Residential</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['multifamily residential']" /> <span>Multifamily Residential</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['commercial']" /> <span>Commercial</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['industrial']" /> <span>Industrial / Business Park</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['parks']" /> <span>Parks</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['open space']" /> <span>Open Space</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['mixed use']" /> <span>Mixed Use</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['civic facilities']" /> <span>Civic / Public Facilities</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['education']" /> <span>Education / Schools</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['health care']" /> <span>Health Care</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['religious']" /> <span>Religious</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['utilities']" /> <span>Utilities / Infrastructure</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['cemeteries']" /> <span>Cemeteries</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['agriculture']" /> <span>Agriculture</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['town center']" /> <span>Town Center / Urban Core</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['institutional use']" /> <span>Institutional</span></label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8125rem; color:#374151;"><input type="checkbox" v-model="gpChecks['apz']" /> <span>APZ (Air Base)</span></label>
            </div>
            <div style="margin-top:0.4rem; display:flex; gap:0.4rem; flex-wrap:wrap;">
              <button @click="()=>{ Object.keys(gpChecks).forEach(k=>gpChecks[k]=false) }" style="background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.6875rem; cursor:pointer;">None</button>
              <button @click="()=>{ ['single family residential','multifamily residential','commercial','industrial','parks','open space','mixed use'].forEach(k=>gpChecks[k]=true) }" style="background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.6875rem; cursor:pointer;">All</button>
            </div>
          </div>
        </div>

        <!-- Results count -->
        <!-- <div style="margin-top:0.5rem; padding-top:0.5rem; border-top:1px solid #e5e7eb; font-size:0.875rem; color:#6b7280; text-align:center;">
          <strong style="color:#1f2937;">{{ filtered.length }}</strong> records shown
        </div> -->
      </div>

      <!-- Expand button removed; dropdowns manage visibility within the panel -->
    </div>
  </main>
</template>
