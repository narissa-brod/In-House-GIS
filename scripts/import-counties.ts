/**
 * Script to fetch Utah county boundaries and import into Supabase
 *
 * Usage:
 *   npm run import-counties
 */

import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Utah AGRC Counties API
const UTAH_COUNTIES_API = 'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahCountyBoundaries/FeatureServer/0/query';

interface CountyFeature {
  properties: {
    NAME?: string;
    COUNTYNBR?: string;
    FIPS?: string;
    FIPS_STR?: string;
    COUNTY_ID?: string;
    STATE_PLANE_AREA?: number;
    ACRES?: number;
    SQ_MILES?: number;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: any;
  };
}

async function fetchUtahCounties(): Promise<CountyFeature[]> {
  console.log('📡 Fetching Utah county boundaries from AGRC...');

  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson'
  });

  const response = await fetch(`${UTAH_COUNTIES_API}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch counties: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`✅ Fetched ${data.features?.length || 0} counties`);
  return data.features || [];
}

// Simple GeoJSON to WKT converter
function geojsonToWKT(geojson: { type: string; coordinates: any }): string {
  if (geojson.type === 'Polygon') {
    const rings = geojson.coordinates.map((ring: any) => {
      const points = ring.map((coord: number[]) => `${coord[0]} ${coord[1]}`).join(', ');
      return `(${points})`;
    }).join(', ');
    return `MULTIPOLYGON((${rings}))`;
  } else if (geojson.type === 'MultiPolygon') {
    const polygons = geojson.coordinates.map((polygon: any) => {
      const rings = polygon.map((ring: any) => {
        const points = ring.map((coord: number[]) => `${coord[0]} ${coord[1]}`).join(', ');
        return `(${points})`;
      }).join(', ');
      return `(${rings})`;
    }).join(', ');
    return `MULTIPOLYGON(${polygons})`;
  }
  throw new Error('Only Polygon and MultiPolygon geometry are supported');
}

function transformCountyForSupabase(feature: CountyFeature) {
  const props = feature.properties;
  const geom = feature.geometry;

  // Convert to WKT format
  const geomWKT = `SRID=4326;${geojsonToWKT(geom)}`;

  return {
    name: props.NAME,
    fips_code: props.FIPS_STR || props.FIPS || props.COUNTYNBR,
    area_sq_mi: props.SQ_MILES,
    geom: geomWKT
  };
}

async function importCounties() {
  try {
    console.log('🚀 Starting Utah county boundaries import...\n');

    // Step 1: Fetch counties
    const features = await fetchUtahCounties();

    // Step 2: Transform data
    console.log('🔄 Transforming county data...');
    const counties = features
      .filter(f => f.properties.NAME)
      .map(transformCountyForSupabase);
    console.log(`✅ Transformed ${counties.length} counties\n`);

    // Step 3: Check if table has data
    console.log('🔍 Checking for existing data...');
    const { count } = await supabase
      .from('counties')
      .select('*', { count: 'exact', head: true });

    if (count && count > 0) {
      console.error(`\n❌ Table already contains ${count} counties!`);
      console.error('Please run this SQL in Supabase SQL Editor first:');
      console.error('   TRUNCATE TABLE counties RESTART IDENTITY CASCADE;');
      console.error('\nThen run this import script again.\n');
      process.exit(1);
    }

    console.log('✅ Table is empty, ready to import\n');

    // Step 4: Insert counties
    console.log(`📦 Inserting ${counties.length} counties...`);

    const { data, error } = await supabase
      .from('counties')
      .insert(counties)
      .select('id, name');

    if (error) {
      console.error('❌ Error inserting counties:', error.message);
      throw error;
    }

    console.log(`\n🎉 Import complete! Successfully imported ${counties.length} counties.`);

    // Step 5: Verify count
    const { count: finalCount, error: countError } = await supabase
      .from('counties')
      .select('*', { count: 'exact', head: true });

    if (!countError) {
      console.log(`✅ Database now contains ${finalCount} counties.\n`);
    }

    // List all counties
    if (data) {
      console.log('Counties imported:');
      data.forEach(c => console.log(`  - ${c.name}`));
    }

  } catch (error: any) {
    console.error('\n❌ Import failed:', error.message);
    process.exit(1);
  }
}

// Run the import
importCounties();
