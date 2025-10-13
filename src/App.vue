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
      <p>Loading from Airtable…</p>
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
        <div style="margin-bottom:0.25rem;">
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
            </div>
            <div style="margin-top:0.4rem; display:flex; gap:0.4rem; flex-wrap:wrap;">
              <button @click="()=>{ Object.keys(gpChecks).forEach(k=>gpChecks[k]=false) }" style="background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.6875rem; cursor:pointer;">None</button>
              <button @click="()=>{ ['single family residential','multifamily residential','commercial','industrial','parks','open space','mixed use'].forEach(k=>gpChecks[k]=true) }" style="background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:0.25rem 0.5rem; font-size:0.6875rem; cursor:pointer;">All</button>
            </div>
          </div>
        </div>

        <!-- Results count -->
        <div style="margin-top:0.5rem; padding-top:0.5rem; border-top:1px solid #e5e7eb; font-size:0.875rem; color:#6b7280; text-align:center;">
          <strong style="color:#1f2937;">{{ filtered.length }}</strong> records shown
        </div>
      </div>

      <!-- Expand button removed; dropdowns manage visibility within the panel -->
    </div>
  </main>
</template>
