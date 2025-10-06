/**
 * Script to fetch Salt Lake County parcel data and import into Supabase
 *
 * Usage:
 *   npm run import-salt-lake
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

// Salt Lake County API configuration
const SALT_LAKE_API_URL = 'https://apps.saltlakecounty.gov/slcogis/rest/services/Assessor/Parcel_Viewer_external/MapServer/5/query';

interface SaltLakeFeature {
  attributes: {
    OBJECTID?: number;
    parcel_id?: string;
    parent_parcel?: string;
    own_name?: string;
    own_addr?: string;
    own_citystate?: string;
    own_zip?: string;
    prop_location?: string;
    parcel_acres?: number;
    full_mkt_prcl_total?: number;
    tax_district?: string;
    property_type?: string;
  };
  geometry: {
    rings: number[][][];
  };
}

async function fetchSaltLakeCountyParcels(): Promise<SaltLakeFeature[]> {
  console.log('📡 Fetching ALL parcels from Salt Lake County API (with pagination)...');

  const allFeatures: SaltLakeFeature[] = [];
  const BATCH_SIZE = 1000; // Salt Lake County might have limits
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    console.log(`   Fetching batch at offset ${offset}...`);

    const params = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
      resultRecordCount: BATCH_SIZE.toString(),
      resultOffset: offset.toString()
    });

    const response = await fetch(`${SALT_LAKE_API_URL}?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch parcels: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      console.log(`   No more parcels (stopped at offset ${offset})`);
      hasMore = false;
      break;
    }

    console.log(`   ✓ Got ${data.features.length} parcels`);
    allFeatures.push(...data.features);

    // If we got fewer than BATCH_SIZE, we've reached the end
    if (data.features.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      offset += BATCH_SIZE;
    }

    // Add a small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`✅ Fetched ${allFeatures.length} total parcels from Salt Lake County API`);
  return allFeatures;
}

function transformParcelForSupabase(feature: SaltLakeFeature) {
  const attrs = feature.attributes;
  const geom = feature.geometry;

  // Convert Esri Polygon rings to GeoJSON Polygon format
  const geojson = {
    type: 'Polygon',
    coordinates: geom.rings
  };

  // Convert to MultiPolygon for consistency
  const multiPolygon = {
    type: 'MultiPolygon',
    coordinates: [geojson.coordinates]
  };

  // Convert GeoJSON to PostGIS WKT format
  const geomWKT = geojsonToWKT(multiPolygon);

  // Parse city/state from own_citystate field (e.g., "SALT LAKE CITY UT")
  let city = '';
  let state = '';
  if (attrs.own_citystate) {
    const parts = attrs.own_citystate.trim().split(/\s+/);
    if (parts.length >= 2) {
      state = parts[parts.length - 1]; // Last part is state
      city = parts.slice(0, -1).join(' '); // Everything before state is city
    }
  }

  return {
    apn: attrs.parcel_id || attrs.parent_parcel,
    object_id: attrs.OBJECTID,
    address: attrs.prop_location,
    city: city || null,
    zip_code: attrs.own_zip,
    county: 'Salt Lake',
    owner_name: attrs.own_name,
    owner_address: attrs.own_addr,
    owner_city: city || null,
    owner_state: state || null,
    owner_zip: attrs.own_zip,
    size_acres: attrs.parcel_acres,
    property_value: attrs.full_mkt_prcl_total,
    property_url: 'https://slco.org/assessor/',
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
    return `SRID=4326;MULTIPOLYGON(${polygons})`;
  }
  throw new Error('Only MultiPolygon geometry is supported');
}

async function importParcels() {
  try {
    console.log('🚀 Starting Salt Lake County parcel import process...\n');

    // Step 1: Fetch parcels from Salt Lake County API
    const features = await fetchSaltLakeCountyParcels();

    // Step 2: Transform data for Supabase
    console.log('🔄 Transforming parcel data...');
    const parcels = features
      .filter(f => f.attributes.parcel_id || f.attributes.parent_parcel) // Only parcels with ID
      .map(transformParcelForSupabase);
    console.log(`✅ Transformed ${parcels.length} parcels\n`);

    // Check for duplicate APNs in the data
    const apnCounts = new Map<string, number>();
    parcels.forEach(p => {
      if (p.apn) {
        apnCounts.set(p.apn, (apnCounts.get(p.apn) || 0) + 1);
      }
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
        if (!p.apn || seen.has(p.apn)) {
          return false;
        }
        seen.add(p.apn);
        return true;
      });

      console.log(`✅ Reduced from ${parcels.length} to ${uniqueParcels.length} unique parcels\n`);
      parcels.length = 0;
      parcels.push(...uniqueParcels);
    }

    // Step 3: Insert in batches (Supabase has a limit on batch size)
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

    console.log(`\n🎉 Import complete! Successfully imported ${inserted} Salt Lake County parcels to Supabase.`);

    // Step 4: Verify count
    const { count: totalCount } = await supabase
      .from('parcels')
      .select('*', { count: 'exact', head: true });

    console.log(`✅ Database now contains ${totalCount} total parcels (all counties).\n`);

  } catch (error: any) {
    console.error('\n❌ Import failed:', error.message);
    process.exit(1);
  }
}

// Run the import
importParcels();
