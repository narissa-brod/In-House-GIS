/**
 * Populate municipal_boundaries table with Davis County cities from Utah AGRC
 *
 * Uses the statewide UtahMunicipalBoundaries service and filters to cities
 * that intersect with Davis County. This provides authoritative boundary polygons
 * for spatial city matching when parcel city attributes are missing.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/populate-municipal-boundaries.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL as string;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY as string;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Utah AGRC Municipal Boundaries service
const MUNICIPAL_BOUNDARIES_URL =
  'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahMunicipalBoundaries/FeatureServer/0/query';

// Davis County cities (from your ParcelSearch.vue)
const DAVIS_COUNTY_CITIES = [
  'Bountiful',
  'Centerville',
  'Clearfield',
  'Clinton',
  'Farmington',
  'Fruit Heights',
  'Kaysville',
  'Layton',
  'North Salt Lake',
  'South Weber',
  'Sunset',
  'Syracuse',
  'West Bountiful',
  'West Point',
  'Woods Cross'
];

interface MunicipalFeature {
  attributes: {
    NAME: string;
    SHORTDESC?: string;
  };
  geometry: {
    rings?: number[][][];
    // Could be polygon or multipolygon
  };
}

async function fetchMunicipalBoundaries(): Promise<MunicipalFeature[]> {
  const allFeatures: MunicipalFeature[] = [];

  // Build WHERE clause for Davis County cities
  // Use case-insensitive LIKE to match variations
  const whereClauses = DAVIS_COUNTY_CITIES.map(city =>
    `upper(NAME) LIKE '${city.toUpperCase().replace(/'/g, "''")}%'`
  );
  const where = whereClauses.join(' OR ');

  console.log(`Fetching municipal boundaries for ${DAVIS_COUNTY_CITIES.length} Davis County cities...`);

  // Fetch with pagination (some services limit results)
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const params = new URLSearchParams({
      where: where,
      outFields: 'NAME,SHORTDESC',
      returnGeometry: 'true',
      outSR: '4326', // WGS84
      f: 'json',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset)
    });

    const url = `${MUNICIPAL_BOUNDARIES_URL}?${params.toString()}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      throw new Error(`Failed to fetch municipal boundaries: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();
    const features: MunicipalFeature[] = data?.features || [];

    if (features.length === 0) break;

    allFeatures.push(...features);
    console.log(`  Fetched ${allFeatures.length} municipal boundaries so far...`);

    // If we got fewer than page size, we're done
    if (features.length < pageSize) break;

    offset += features.length;
  }

  return allFeatures;
}

function convertToGeoJSON(geometry: any): string | null {
  if (!geometry || !geometry.rings) return null;

  const rings = geometry.rings;
  if (rings.length === 0) return null;

  // Convert to GeoJSON MultiPolygon
  // ArcGIS returns rings where outer rings are clockwise, holes are counter-clockwise
  // For PostGIS, we need to group rings into polygons (outer + holes)
  const polygons: number[][][][] = [];

  // Simple approach: treat each ring as a separate polygon
  // A more sophisticated approach would group outer rings with their holes
  for (const ring of rings) {
    polygons.push([ring]);
  }

  const geojson = {
    type: 'MultiPolygon',
    coordinates: polygons
  };

  return JSON.stringify(geojson);
}

async function populateMunicipalBoundaries() {
  console.log('Starting municipal boundaries population...\n');

  // Fetch boundaries from AGRC
  const features = await fetchMunicipalBoundaries();
  console.log(`\nFetched ${features.length} municipal boundary features\n`);

  if (features.length === 0) {
    console.log('No features found. Exiting.');
    return;
  }

  // Clear existing Davis County data (based on our city list)
  console.log('Clearing existing Davis County municipal_boundaries...');
  const { error: deleteError } = await supabase
    .from('municipal_boundaries')
    .delete()
    .in('name', DAVIS_COUNTY_CITIES);

  if (deleteError && deleteError.code !== 'PGRST116') {
    // PGRST116 = no rows found, which is fine
    console.error('Failed to clear existing data:', deleteError.message);
    throw deleteError;
  }

  // Prepare data for batch insert
  console.log('Preparing municipal boundaries for batch insert...\n');
  const records: any[] = [];

  for (const feature of features) {
    const name = feature.attributes.NAME;
    const muniType = feature.attributes.SHORTDESC || null;
    const geojson = convertToGeoJSON(feature.geometry);

    if (!geojson) {
      console.warn(`  Skipping ${name}: no valid geometry`);
      continue;
    }

    records.push({
      name,
      muni_type: muniType,
      source: 'Utah AGRC UtahMunicipalBoundaries',
      geom: geojson
    });

    console.log(`  ✓ Prepared ${name}${muniType ? ` (${muniType})` : ''}`);
  }

  if (records.length === 0) {
    console.log('\nNo valid records to insert. Exiting.');
    return;
  }

  // Insert in batches using the insert_municipal_boundaries RPC
  console.log(`\nInserting ${records.length} municipal boundaries via RPC...`);

  const { data, error } = await supabase.rpc('insert_municipal_boundaries', {
    boundaries_data: records
  });

  if (error) {
    console.error('Batch insert failed:', error.message);
    throw error;
  }

  const inserted = data?.[0]?.inserted_count ?? 0;
  console.log(`\nSuccessfully inserted ${inserted} municipal boundaries`);

  // Verify the data
  const { count, error: countError } = await supabase
    .from('municipal_boundaries')
    .select('*', { count: 'exact', head: true });

  if (!countError) {
    console.log(`\nVerification: municipal_boundaries table now contains ${count} records`);
  }
}

async function main() {
  try {
    await populateMunicipalBoundaries();
    console.log('\n✅ Municipal boundaries population complete!');
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
