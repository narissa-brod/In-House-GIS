/**
 * Import general plan data from GeoJSON into Supabase (PostGIS)
 *
 * Usage:
 *   npm run import-general-plan -- path/to/general_plan.geojson
 *
 * Or add to package.json:
 *   "import-general-plan": "npx tsx --env-file=.env scripts/import-general-plan.ts"
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Get GeoJSON file path from command line args
const geojsonPath = process.argv[2];

if (!geojsonPath) {
  console.error('❌ Please provide a GeoJSON file path');
  console.error('Usage: npm run import-general-plan -- path/to/general_plan.geojson');
  process.exit(1);
}

if (!fs.existsSync(geojsonPath)) {
  console.error(`❌ File not found: ${geojsonPath}`);
  process.exit(1);
}

// Supabase client with service role key (has write permissions)
const supabase = createClient(
  process.env.VITE_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

interface GeneralPlanFeature {
  type: 'Feature';
  properties: {
    name?: string;
    description?: string;
    zone_name?: string;
    zone_code?: string;
    zone_type?: string;
    [key: string]: any; // KMZ files have varying properties
  };
  geometry: any;
}

interface GeneralPlanRow {
  zone_name: string | null;
  zone_code: string | null;
  zone_type: string | null;
  name: string | null;
  description: string | null;
  county: string | null;
  city: string | null;
  year_adopted: number | null;
  source: string;
  geom: string; // GeoJSON string
}

// Normalize zone type from zone name/description
function inferZoneType(zoneName?: string, zoneCode?: string, description?: string): string | null {
  const text = `${zoneName || ''} ${zoneCode || ''} ${description || ''}`.toLowerCase();

  if (text.match(/residential|housing|dwelling|r-\d+|rld|rhd/)) return 'residential';
  if (text.match(/commercial|retail|business|c-\d+/)) return 'commercial';
  if (text.match(/industrial|manufacturing|i-\d+/)) return 'industrial';
  if (text.match(/agricultural|farm|ag-\d+/)) return 'agricultural';
  if (text.match(/mixed.?use|mu-\d+/)) return 'mixed-use';
  if (text.match(/open.?space|park|recreation/)) return 'open-space';
  if (text.match(/public|institutional|school|government/)) return 'public';

  return 'other';
}

async function importGeneralPlan() {
  console.log(`\n📂 Reading GeoJSON file: ${geojsonPath}`);

  const geojsonContent = fs.readFileSync(geojsonPath, 'utf-8');
  const geojson = JSON.parse(geojsonContent);

  if (!geojson.features || !Array.isArray(geojson.features)) {
    console.error('❌ Invalid GeoJSON: missing features array');
    process.exit(1);
  }

  const features = geojson.features as GeneralPlanFeature[];
  console.log(`✅ Found ${features.length} features`);

  // Extract metadata from filename or prompt
  const fileName = path.basename(geojsonPath, path.extname(geojsonPath));
  const countyMatch = fileName.match(/(davis|salt.?lake|weber|utah|cache)/i);
  const county = countyMatch ? countyMatch[1] : null;

  console.log(`\n🗺️  County detected: ${county || 'unknown'}`);
  console.log(`📅 Source: KMZ conversion from ${fileName}`);

  // Helper to remove Z dimension from coordinates
  function stripZDimension(geometry: any): any {
    if (!geometry) return geometry;

    const strip = (coords: any): any => {
      if (typeof coords[0] === 'number') {
        // Single coordinate [x, y, z] -> [x, y]
        return coords.slice(0, 2);
      }
      // Array of coordinates or nested arrays
      return coords.map(strip);
    };

    return {
      ...geometry,
      coordinates: strip(geometry.coordinates)
    };
  }

  // Transform features to database rows
  const rows: GeneralPlanRow[] = features.map((feature) => {
    const props = feature.properties || {};

    // Extract zone info from various possible KMZ property names
    const zoneName = props.zone_name || props.name || props.Name || props.ZONE || null;
    const zoneCode = props.zone_code || props.code || props.Code || props.ZONE_CODE || null;
    const description = props.description || props.Description || null;
    const zoneType = props.zone_type || inferZoneType(zoneName, zoneCode, description);

    // Strip Z dimension from geometry (KMZ files often have 3D coordinates)
    const geometry2D = stripZDimension(feature.geometry);

    return {
      zone_name: zoneName,
      zone_code: zoneCode,
      zone_type: zoneType,
      name: props.name || props.Name || null,
      description: description,
      county: county,
      city: props.city || props.City || null,
      year_adopted: props.year_adopted || props.year || null,
      source: `KMZ conversion: ${fileName}`,
      geom: JSON.stringify(geometry2D)
    };
  });

  console.log(`\n🔄 Importing ${rows.length} general plan zones...`);

  // Clear existing data for this county (optional - remove if you want to append)
  if (county) {
    console.log(`⚠️  Clearing existing ${county} County general plan data...`);
    const { error: deleteError } = await supabase
      .from('general_plan')
      .delete()
      .eq('county', county);

    if (deleteError) {
      console.warn('⚠️  No existing data to clear (this is OK for first import)');
    }
  }

  // Insert in batches (Supabase has a limit)
  const BATCH_SIZE = 1000;
  let imported = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from('general_plan')
      .insert(batch)
      .select();

    if (error) {
      console.error(`\n❌ Error inserting batch ${i / BATCH_SIZE + 1}:`, error);
      throw error;
    }

    imported += batch.length;
    console.log(`  ✓ Imported ${imported}/${rows.length} zones`);
  }

  console.log(`\n✅ Successfully imported ${imported} general plan zones!`);

  // Show zone type breakdown
  const { data: stats } = await supabase
    .from('general_plan')
    .select('zone_type')
    .eq('county', county || 'unknown');

  if (stats) {
    const breakdown = stats.reduce((acc: Record<string, number>, row: any) => {
      acc[row.zone_type || 'unknown'] = (acc[row.zone_type || 'unknown'] || 0) + 1;
      return acc;
    }, {});

    console.log('\n📊 Zone type breakdown:');
    Object.entries(breakdown).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });
  }
}

// Run import
importGeneralPlan()
  .then(() => {
    console.log('\n✨ Import complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  });
