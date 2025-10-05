/**
 * Script to fetch Davis County parcel data and import into Supabase
 *
 * Usage:
 *   npm install tsx --save-dev
 *   npx tsx scripts/import-parcels.ts
 *
 * Or add to package.json scripts:
 *   "import-parcels": "tsx scripts/import-parcels.ts"
 */

import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!; // Need service role key for bulk inserts

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in environment variables');
  console.error('Current env vars:', {
    hasUrl: !!process.env.VITE_SUPABASE_URL,
    hasKey: !!process.env.SUPABASE_SERVICE_KEY
  });
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Davis County API configuration
const DAVIS_COUNTY_API_URL = 'https://gisportal-pro.daviscountyutah.gov/server/rest/services/Operational/Parcels/MapServer/0/query';

interface DavisCountyFeature {
  properties: {
    OBJECTID?: number;
    ParcelTaxID?: string;
    ParcelOwnerName?: string;
    ParcelOwnerMailAddressLine1?: string;
    ParcelOwnerMailCity?: string;
    ParcelOwnerMailState?: string;
    ParcelOwnerMailZipcode?: string;
    ParcelFullSitusAddress?: string;
    ParcelAcreage?: number;
    ParcelAcres?: number;
    Acreage?: number;
    ACRES?: number;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: any;
  };
}

async function fetchDavisCountyParcels(): Promise<DavisCountyFeature[]> {
  console.log('📡 Fetching parcels from Davis County API...');

  const params = new URLSearchParams({
    where: '1=1',
    outFields: [
      'OBJECTID',
      'ParcelTaxID',
      'ParcelOwnerName',
      'ParcelOwnerMailAddressLine1',
      'ParcelOwnerMailCity',
      'ParcelOwnerMailState',
      'ParcelOwnerMailZipcode',
      'ParcelFullSitusAddress',
      'ParcelAcreage'
    ].join(','),
    returnGeometry: 'true',
    outSR: '4326', // WGS84 coordinate system
    f: 'geojson',
    resultRecordCount: '10000' // Maximum records
  });

  const response = await fetch(`${DAVIS_COUNTY_API_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch parcels: ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.features || data.features.length === 0) {
    throw new Error('No parcels returned from Davis County API');
  }

  console.log(`✅ Fetched ${data.features.length} parcels`);
  return data.features;
}

function transformParcelForSupabase(feature: DavisCountyFeature) {
  const props = feature.properties;
  const geom = feature.geometry;

  // Convert Polygon to MultiPolygon if needed
  let finalGeom = geom;
  if (geom.type === 'Polygon') {
    finalGeom = {
      type: 'MultiPolygon',
      coordinates: [geom.coordinates]
    };
  }

  // Convert GeoJSON to PostGIS WKT format
  const geomWKT = `SRID=4326;${geojsonToWKT(finalGeom)}`;

  return {
    apn: props.ParcelTaxID,
    object_id: props.OBJECTID,
    address: props.ParcelFullSitusAddress,
    city: props.ParcelOwnerMailCity,
    zip_code: props.ParcelOwnerMailZipcode,
    county: 'Davis',
    owner_name: props.ParcelOwnerName,
    owner_address: props.ParcelOwnerMailAddressLine1,
    owner_city: props.ParcelOwnerMailCity,
    owner_state: props.ParcelOwnerMailState,
    owner_zip: props.ParcelOwnerMailZipcode,
    size_acres: props.ParcelAcreage || props.ParcelAcres || props.Acreage || props.ACRES,
    property_url: 'https://webportal.daviscountyutah.gov/App/PropertySearch/esri/map',
    geom: geomWKT
  };
}

// Simple GeoJSON to WKT converter for MultiPolygon
function geojsonToWKT(geojson: { type: string; coordinates: any }): string {
  if (geojson.type === 'MultiPolygon') {
    const polygons = geojson.coordinates.map((polygon: any) => {
      const rings = polygon.map((ring: any) => {
        const points = ring.map((coord: number[]) => `${coord[0]} ${coord[1]}`).join(', ');
        return `(${points})`;
      }).join(', ');
      return `(${rings})`;
    }).join(', ');
    return `MULTIPOLYGON(${polygons})`;
  }
  throw new Error('Only MultiPolygon geometry is supported');
}

async function importParcels() {
  try {
    console.log('🚀 Starting parcel import process...\n');

    // Step 1: Fetch parcels from Davis County API
    const features = await fetchDavisCountyParcels();

    // Step 2: Transform data for Supabase
    console.log('🔄 Transforming parcel data...');
    const parcels = features
      .filter(f => f.properties.ParcelTaxID) // Only parcels with APN
      .map(transformParcelForSupabase);
    console.log(`✅ Transformed ${parcels.length} parcels\n`);

    // Check for duplicate APNs in the data
    const apnCounts = new Map<string, number>();
    parcels.forEach(p => {
      apnCounts.set(p.apn, (apnCounts.get(p.apn) || 0) + 1);
    });
    const duplicates = Array.from(apnCounts.entries()).filter(([_, count]) => count > 1);

    if (duplicates.length > 0) {
      console.warn(`⚠️  Found ${duplicates.length} duplicate APNs in the data:`);
      duplicates.slice(0, 5).forEach(([apn, count]) => {
        console.warn(`   ${apn}: ${count} times`);
      });
      console.log('\n🔧 Removing duplicates (keeping first occurrence)...');

      // Remove duplicates - keep only first occurrence of each APN
      const seen = new Set<string>();
      const uniqueParcels = parcels.filter(p => {
        if (seen.has(p.apn)) {
          return false;
        }
        seen.add(p.apn);
        return true;
      });

      console.log(`✅ Reduced from ${parcels.length} to ${uniqueParcels.length} unique parcels\n`);
      parcels.length = 0;
      parcels.push(...uniqueParcels);
    }

    // Step 3: Check if table has data, if so, prompt user to clear it manually
    console.log('🔍 Checking for existing data...');
    const { count } = await supabase
      .from('parcels')
      .select('*', { count: 'exact', head: true });

    if (count && count > 0) {
      console.error(`\n❌ Table already contains ${count} parcels!`);
      console.error('Please run this SQL in Supabase SQL Editor first:');
      console.error('   TRUNCATE TABLE parcels RESTART IDENTITY CASCADE;');
      console.error('\nThen run this import script again.\n');
      process.exit(1);
    }

    console.log('✅ Table is empty, ready to import\n');

    // Step 4: Insert in batches (Supabase has a limit on batch size)
    const BATCH_SIZE = 500;
    let inserted = 0;

    console.log(`📦 Inserting ${parcels.length} parcels in batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < parcels.length; i += BATCH_SIZE) {
      const batch = parcels.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      // Retry logic for network errors
      let retries = 3;
      let success = false;

      while (retries > 0 && !success) {
        try {
          const { data, error } = await supabase
            .from('parcels')
            .insert(batch)
            .select('id');

          if (error) {
            console.error(`❌ Error inserting batch ${batchNum}:`, error.message);
            console.error('Sample failed record:', batch[0]);
            throw error;
          }

          inserted += batch.length;
          console.log(`   ✓ Batch ${batchNum}: Inserted ${batch.length} parcels (${inserted}/${parcels.length})`);
          success = true;

        } catch (err: any) {
          retries--;
          if (retries > 0) {
            console.warn(`   ⚠️  Batch ${batchNum} failed, retrying... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
          } else {
            console.error(`❌ Batch ${batchNum} failed after all retries`);
            throw err;
          }
        }
      }
    }

    console.log(`\n🎉 Import complete! Successfully imported ${inserted} parcels to Supabase.`);

    // Step 5: Verify count
    const { count: finalCount, error: countError } = await supabase
      .from('parcels')
      .select('*', { count: 'exact', head: true });

    if (!countError) {
      console.log(`✅ Database now contains ${finalCount} total parcels.\n`);
    }

  } catch (error: any) {
    console.error('\n❌ Import failed:', error.message);
    process.exit(1);
  }
}

// Run the import
importParcels();
