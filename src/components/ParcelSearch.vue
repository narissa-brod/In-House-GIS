<template>
  <div class="parcel-search">
    <div class="search-header">
      <h3>Parcel Search</h3>
      <button @click="toggleExpanded" class="toggle-btn">
        {{ isExpanded ? '▼' : '▶' }}
      </button>
    </div>

    <div v-if="isExpanded" class="search-content">
      <div class="filter-section">
        <label>Property Class</label>
        <select v-model="filters.propClass" multiple size="5">
          <option value="">All Classes</option>
          <option value="Vacant">Vacant</option>
          <option value="Residential">Residential</option>
          <option value="Commercial - Office Space">Commercial - Office Space</option>
          <option value="Commercial - Retail">Commercial - Retail</option>
          <option value="Commercial - Warehouse">Commercial - Warehouse</option>
          <option value="Industrial">Industrial</option>
          <option value="Agricultural">Agricultural</option>
          <option value="Mixed">Mixed</option>
        </select>
        <small>Hold Ctrl/Cmd to select multiple</small>
      </div>

      <div class="filter-section">
        <label>Acreage Range</label>
        <div class="range-inputs">
          <input
            type="number"
            v-model.number="filters.minAcres"
            placeholder="Min acres"
            step="0.1"
          />
          <span>to</span>
          <input
            type="number"
            v-model.number="filters.maxAcres"
            placeholder="Max acres"
            step="0.1"
          />
        </div>
      </div>

      <div class="filter-section">
        <label>Market Value Range</label>
        <div class="range-inputs">
          <input
            type="number"
            v-model.number="filters.minValue"
            placeholder="Min $"
            step="10000"
          />
          <span>to</span>
          <input
            type="number"
            v-model.number="filters.maxValue"
            placeholder="Max $"
            step="10000"
          />
        </div>
      </div>

      <!-- Building Status removed to avoid over-filtering -->

      <div class="filter-section">
        <label>City</label>
        <select v-model="filters.cities" multiple size="4">
          <option value="">All Cities</option>
          <option value="Bountiful">Bountiful</option>
          <option value="Centerville">Centerville</option>
          <option value="Clearfield">Clearfield</option>
          <option value="Clinton">Clinton</option>
          <option value="Farmington">Farmington</option>
          <option value="Fruit Heights">Fruit Heights</option>
          <option value="Kaysville">Kaysville</option>
          <option value="Layton">Layton</option>
          <option value="North Salt Lake">North Salt Lake</option>
          <option value="South Weber">South Weber</option>
          <option value="Sunset">Sunset</option>
          <option value="Syracuse">Syracuse</option>
          <option value="West Bountiful">West Bountiful</option>
          <option value="West Point">West Point</option>
          <option value="Woods Cross">Woods Cross</option>
        </select>
      </div>

      <div class="action-buttons">
        <button @click="executeSearch" class="search-btn" :disabled="isSearching">
          {{ isSearching ? 'Searching...' : 'Search Parcels' }}
        </button>
        <button @click="clearFilters" class="clear-btn">Clear Filters</button>
      </div>

      <div v-if="searchResults.length > 0" class="results-section">
        <div class="results-header">
          <span>Found {{ searchResults.length }} parcels</span>
          <div>
            <button @click="exportCSV" class="export-btn">Export APNs to CSV</button>
            <button @click="clearResults" class="clear-results-btn">Clear Results</button>
          </div>
        </div>

        <div class="results-preview">
          <div v-for="parcel in searchResults.slice(0, 5)" :key="parcel.apn" class="result-item">
            <strong>{{ parcel.apn }}</strong>
            <span>{{ parcel.address || 'No address' }}</span>
            <span>{{ parcel.prop_class }}</span>
            <span>{{ parcel.parcel_acres?.toFixed(2) }} ac</span>
            <span v-if="parcel.total_mkt_value">${{ formatCurrency(parcel.total_mkt_value) }}</span>
          </div>
          <p v-if="searchResults.length > 5" class="more-results">
            + {{ searchResults.length - 5 }} more results
          </p>
        </div>
      </div>

      <div v-if="errorMessage" class="error-message">
        {{ errorMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';

// Types
type ParcelSearchResult = {
  id: number;
  apn: string;
  address: string | null;
  city: string | null;
  prop_class: string | null;
  bldg_sqft: number | null;
  built_yr: number | null;
  parcel_acres: number | null;
  total_mkt_value: number | null;
  land_mkt_value: number | null;
  geom: string; // GeoJSON string
};

// Props & Emits
const emit = defineEmits<{
  (e: 'searchResults', results: ParcelSearchResult[]): void;
  (e: 'clearResults'): void;
}>();

// State
const isExpanded = ref(true);
const isSearching = ref(false);
const searchResults = ref<ParcelSearchResult[]>([]);
const errorMessage = ref('');

const filters = reactive({
  propClass: [] as string[],
  minAcres: null as number | null,
  maxAcres: null as number | null,
  minValue: null as number | null,
  maxValue: null as number | null,
  // hasBuilding removed
  cities: [] as string[]
});

// Methods
function toggleExpanded() {
  isExpanded.value = !isExpanded.value;
}

async function executeSearch() {
  isSearching.value = true;
  errorMessage.value = '';

  try {
    // Import supabase client
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY
    );

    // Build query parameters for search_parcels function
    const params: any = {};

    if (filters.minAcres !== null) params.min_acres = filters.minAcres;
    if (filters.maxAcres !== null) params.max_acres = filters.maxAcres;
    if (filters.minValue !== null) params.min_value = filters.minValue;
    if (filters.maxValue !== null) params.max_value = filters.maxValue;
    // No building filter applied

    // Filter out empty strings from arrays
    const propClasses = filters.propClass.filter(c => c !== '');
    if (propClasses.length > 0) params.prop_classes = propClasses;

    const cities = filters.cities.filter(c => c !== '');
    if (cities.length > 0) params.cities = cities;

    // Always set Davis County filter
    params.county_filter = 'Davis';
    params.result_limit = 5000; // Allow more results; SQL still LIMITs

    // Call the search_parcels function
    const { data, error } = await supabase.rpc('search_parcels', params);

    if (error) {
      throw error;
    }

    searchResults.value = data || [];

    // Emit results to parent component for map rendering
    emit('searchResults', searchResults.value);

    if (searchResults.value.length === 0) {
      errorMessage.value = 'No parcels found matching your criteria. Try broadening your filters.';
    }
  } catch (error: any) {
    console.error('Search error:', error);
    errorMessage.value = `Search failed: ${error.message || 'Unknown error'}`;
    searchResults.value = [];
  } finally {
    isSearching.value = false;
  }
}

function clearFilters() {
  filters.propClass = [];
  filters.minAcres = null;
  filters.maxAcres = null;
  filters.minValue = null;
  filters.maxValue = null;
  // hasBuilding removed
  filters.cities = [];
  errorMessage.value = '';
}

function clearResults() {
  searchResults.value = [];
  emit('clearResults');
  errorMessage.value = '';
}

function exportCSV() {
  if (searchResults.value.length === 0) return;

  // Create CSV content
  const headers = ['APN', 'Address', 'City', 'Property Class', 'Acres', 'Market Value', 'Building Sqft'];
  const rows = searchResults.value.map(p => [
    p.apn,
    p.address || '',
    p.city || '',
    p.prop_class || '',
    p.parcel_acres?.toFixed(2) || '',
    p.total_mkt_value ? `$${p.total_mkt_value}` : '',
    p.bldg_sqft || ''
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  // Download CSV
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `parcel_search_results_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
</script>

<style scoped>
.parcel-search {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  margin-bottom: 16px;
}

.search-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
  cursor: pointer;
}

.search-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.toggle-btn {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
}

.search-content {
  padding: 16px;
}

.filter-section {
  margin-bottom: 16px;
}

.filter-section label {
  display: block;
  font-weight: 500;
  margin-bottom: 6px;
  font-size: 14px;
  color: #333;
}

.filter-section select,
.filter-section input {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.filter-section select[multiple] {
  height: auto;
}

.filter-section small {
  display: block;
  margin-top: 4px;
  color: #666;
  font-size: 12px;
}

.range-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
}

.range-inputs input {
  flex: 1;
}

.range-inputs span {
  color: #666;
  font-size: 14px;
}

.action-buttons {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.search-btn,
.clear-btn,
.export-btn,
.clear-results-btn {
  padding: 10px 16px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.search-btn {
  flex: 1;
  background-color: #2196F3;
  color: white;
}

.search-btn:hover:not(:disabled) {
  background-color: #1976D2;
}

.search-btn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.clear-btn {
  background-color: #f5f5f5;
  color: #333;
}

.clear-btn:hover {
  background-color: #e0e0e0;
}

.results-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 2px solid #e0e0e0;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.results-header span {
  font-weight: 600;
  color: #333;
}

.results-header div {
  display: flex;
  gap: 8px;
}

.export-btn {
  background-color: #4CAF50;
  color: white;
}

.export-btn:hover {
  background-color: #45a049;
}

.clear-results-btn {
  background-color: #f44336;
  color: white;
}

.clear-results-btn:hover {
  background-color: #da190b;
}

.results-preview {
  background: #f9f9f9;
  border-radius: 4px;
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.result-item {
  display: grid;
  grid-template-columns: 120px 1fr 150px 80px 100px;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid #e0e0e0;
  font-size: 13px;
}

.result-item:last-child {
  border-bottom: none;
}

.result-item strong {
  color: #2196F3;
}

.more-results {
  text-align: center;
  color: #666;
  font-style: italic;
  margin-top: 8px;
  margin-bottom: 0;
}

.error-message {
  margin-top: 12px;
  padding: 12px;
  background-color: #ffebee;
  color: #c62828;
  border-radius: 4px;
  font-size: 14px;
}
</style>
