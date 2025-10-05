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
        <Map ref="mapRef" :rows="filtered" :style="{ height: '100%', width: '100%' }" />
      </div>

      <!-- Filter Panel (Left Side) - On top of map -->
      <div style="position:absolute; top:5rem; left:0.625rem; background:white; padding:1rem 1.25rem; border-radius:0.5rem; box-shadow:0 0.125rem 0.5rem rgba(0,0,0,0.15); z-index:1003; font-family: system-ui, sans-serif; min-width:12rem; max-width:16rem; max-height:calc(100vh - 12rem); overflow-y:auto;">
        <div style="font-size:0.8125rem; font-weight:700; color:#1f2937; margin-bottom:0.875rem; text-transform:uppercase; letter-spacing:0.03125rem;">
          Filters
        </div>

        <!-- City Filter -->
        <div style="margin-bottom:1rem;">
          <div style="display:block; font-size:0.75rem; color:#6b7280; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03rem;">
            City
          </div>
          <div style="display:flex; flex-direction:column; gap:0.375rem;">
            <label v-for="city in cities" :key="city" style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151;">
              <input
                type="checkbox"
                :value="city"
                v-model="selectedCities"
                style="width:1rem; height:1rem; cursor:pointer; accent-color:#2563eb;"
              />
              <span>{{ city }}</span>
            </label>
          </div>
        </div>

        <!-- Price Filter -->
        <div style="margin-bottom:1rem;">
          <div style="display:block; font-size:0.75rem; color:#6b7280; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03rem;">
            Price
          </div>
          <div style="display:flex; flex-direction:column; gap:0.375rem;">
            <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151;">
              <input
                type="checkbox"
                value="under100k"
                v-model="selectedPrices"
                style="width:1rem; height:1rem; cursor:pointer; accent-color:#2563eb;"
              />
              <span>Under $100k</span>
            </label>
            <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151;">
              <input
                type="checkbox"
                value="100k-500k"
                v-model="selectedPrices"
                style="width:1rem; height:1rem; cursor:pointer; accent-color:#2563eb;"
              />
              <span>$100k - $500k</span>
            </label>
            <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151;">
              <input
                type="checkbox"
                value="over500k"
                v-model="selectedPrices"
                style="width:1rem; height:1rem; cursor:pointer; accent-color:#2563eb;"
              />
              <span>Over $500k</span>
            </label>
          </div>
        </div>

        <!-- Tag Filter -->
        <div style="margin-bottom:0.625rem;">
          <div style="display:block; font-size:0.75rem; color:#6b7280; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03rem;">
            Tags
          </div>
          <div style="display:flex; flex-direction:column; gap:0.375rem;">
            <label v-for="tag in tags" :key="tag" style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem; font-weight:500; color:#374151;">
              <input
                type="checkbox"
                :value="tag"
                v-model="selectedTags"
                style="width:1rem; height:1rem; cursor:pointer; accent-color:#2563eb;"
              />
              <span>{{ tag }}</span>
            </label>
          </div>
        </div>

        <!-- Results count -->
        <div style="margin-top:1rem; padding-top:1rem; border-top:1px solid #e5e7eb; font-size:0.875rem; color:#6b7280; text-align:center;">
          <strong style="color:#1f2937;">{{ filtered.length }}</strong> properties shown
        </div>
      </div>
    </div>
  </main>
</template>