<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { fetchAllAirtable, type AirtableRecord } from './lib/airtable';
import Map from './components/Map.vue';

const loading = ref(true);
const error = ref<string | null>(null);
const rows = ref<AirtableRecord[]>([]);
const filtered = ref<AirtableRecord[]>([]);
const q = ref('');
const mapRef = ref<InstanceType<typeof Map> | null>(null);
const isFullscreen = ref(false);
let timer: number | undefined;

async function loadData() {
  loading.value = true;
  error.value = null;
  try {
    const data = await fetchAllAirtable();
    rows.value = data;
    applyFilter();
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

function applyFilter() {
  const term = q.value.toLowerCase();
  filtered.value = rows.value.filter(r => {
    const f = r.fields || {};
    return [f.Name, f.Nickname, f.Address, f.City, f.APN, f.TAGS, f.Stage]
      .some(v => (v ?? '').toString().toLowerCase().includes(term));
  });
}

function focusRow(id: string) {
  mapRef.value?.focusOn(id);
}

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value;
}
</script>

<template>
  <main :style="{ 
    padding: isFullscreen ? '0' : '1rem', 
    maxWidth: isFullscreen ? '100%' : '1200px', 
    margin: '0 auto',
    height: isFullscreen ? '100vh' : 'auto',
    overflow: isFullscreen ? 'hidden' : 'auto'
  }">
    <div v-if="!isFullscreen">
      <h1 style="margin-bottom:0.5rem;">Land Acquisition GIS</h1>

      <div style="display:flex; gap:0.5rem; align-items:center; margin:0.5rem 0 1rem;">
        <input
          v-model="q" @input="applyFilter"
          placeholder="Filter by name, address, city, APN, tags…"
          style="flex:1; padding:0.5rem 0.75rem; border:1px solid #ccc; border-radius:8px;"
        />
        <button @click="loadData" style="padding:0.5rem 0.75rem; border:1px solid #ccc; border-radius:8px; cursor:pointer;">
          Refresh
        </button>
        <div><strong>{{ filtered.length }}</strong> shown</div>
      </div>

      <p v-if="loading">Loading from Airtable…</p>
      <p v-else-if="error" style="color:red;">Error: {{ error }}</p>
    </div>

    <div v-if="!loading && !error">
      <!-- Map wrapper with conditional height -->
      <div :style="{ 
        height: isFullscreen ? '100vh' : '600px',
        position: isFullscreen ? 'fixed' : 'relative',
        top: isFullscreen ? '0' : 'auto',
        left: isFullscreen ? '0' : 'auto',
        right: isFullscreen ? '0' : 'auto',
        bottom: isFullscreen ? '0' : 'auto',
        zIndex: isFullscreen ? 999 : 'auto',
        width: isFullscreen ? '100vw' : '100%'
      }">
        <!-- Fullscreen toggle button -->
        <button 
          @click="toggleFullscreen"
          :style="{
            position: 'absolute',
            top: '10px',
            right: '10px',
            zIndex: 1001,
            padding: '0.5rem 0.75rem',
            border: '1px solid #ccc',
            borderRadius: '8px',
            backgroundColor: 'white',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            fontWeight: '500'
          }"
        >
          {{ isFullscreen ? '✕ Exit Fullscreen' : '⛶ Fullscreen Map' }}
        </button>

        <Map ref="mapRef" :rows="filtered" :style="{ height: '100%', width: '100%' }" />
      </div>

      <!-- Table hidden in fullscreen mode -->
      <table 
        v-if="!isFullscreen"
        border="1" 
        cellpadding="6" 
        cellspacing="0" 
        style="width:100%; border-collapse:collapse; margin-top:1rem;"
      >
        <thead>
          <tr>
            <th style="text-align:left;">Name/Nickname</th>
            <th style="text-align:left;">Address</th>
            <th style="text-align:left;">City</th>
            <th>Size (ac)</th>
            <th style="text-align:left;">Price</th>
            <th style="text-align:left;">Stage/TAGS</th>
          </tr>
        </thead>
        <tbody>
          <tr 
            v-for="r in filtered" 
            :key="r.id" 
            @click="focusRow(r.id)" 
            style="cursor:pointer; transition: background-color 0.2s;"
          >
            <td>{{ r.fields.Name ?? r.fields.Nickname ?? '—' }}</td>
            <td>{{ r.fields.Address ?? '—' }}</td>
            <td>{{ r.fields.City ?? '—' }}</td>
            <td style="text-align:right;">{{ r.fields.Size ?? '—' }}</td>
            <td>{{ r.fields.Price ?? '—' }}</td>
            <td>{{ r.fields.Stage ?? r.fields.TAGS ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
</template>

<style scoped>
tbody tr:hover {
  background-color: #f5f5f5;
}
</style>