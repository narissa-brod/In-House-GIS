/**
 * Upload Layton City overlay GeoJSON files to Supabase
 *
 * Prerequisites:
 * 1. Run create-overlays-table.sql in Supabase SQL Editor first
 * 2. Ensure you have fetched the GeoJSON files (run fetch-layton-overlays.ts)
 *
 * Usage: npx tsx scripts/upload-overlays-to-supabase.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('   Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface GeoJSONFeature {
  type: 'Feature';
  geometry: any;
  properties: Record<string, any>;
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  name: string;
  metadata: {
    title: string;
    description: string;
    color: string;
    source_url: string;
    feature_count: number;
  };
  features: GeoJSONFeature[];
}

/**
 * Convert GeoJSON geometry to WKT (Well-Known Text) for PostGIS
 */
function geometryToWKT(geometry: any): string {
  if (!geometry || !geometry.type) {
    throw new Error('Invalid geometry');
  }

  const { type, coordinates } = geometry;

  switch (type) {
    case 'Point':
      return `POINT(${coordinates[0]} ${coordinates[1]})`;

    case 'LineString':
      return `LINESTRING(${coordinates.map((c: number[]) => c.join(' ')).join(', ')})`;

    case 'Polygon':
      const rings = coordinates.map((ring: number[][]) =>
        `(${ring.map((c: number[]) => c.join(' ')).join(', ')})`
      ).join(', ');
      return `POLYGON(${rings})`;

    case 'MultiPoint':
      const points = coordinates.map((c: number[]) => `(${c.join(' ')})`).join(', ');
      return `MULTIPOINT(${points})`;

    case 'MultiLineString':
      const lines = coordinates.map((line: number[][]) =>
        `(${line.map((c: number[]) => c.join(' ')).join(', ')})`
      ).join(', ');
      return `MULTILINESTRING(${lines})`;

    case 'MultiPolygon':
      const polygons = coordinates.map((polygon: number[][][]) =>
        `(${polygon.map((ring: number[][]) =>
          `(${ring.map((c: number[]) => c.join(' ')).join(', ')})`
        ).join(', ')})`
      ).join(', ');
      return `MULTIPOLYGON(${polygons})`;

    default:
      throw new Error(`Unsupported geometry type: ${type}`);
  }
}

/**
 * Upload a single layer to Supabase
 */
async function uploadLayer(geojson: GeoJSONCollection): Promise<void> {
  const layerName = geojson.name;
  const metadata = geojson.metadata;

  console.log(`\n📦 Uploading layer: ${metadata.title}`);
  console.log(`   Features: ${geojson.features.length}`);

  // First, delete existing features for this layer
  const { error: deleteError } = await supabase
    .from('layton_overlays')
    .delete()
    .eq('layer_name', layerName);

  if (deleteError) {
    console.warn(`   ⚠️  Warning: Could not delete existing features:`, deleteError.message);
  } else {
    console.log(`   🗑️  Cleared existing features`);
  }

  // Batch insert features
  const BATCH_SIZE = 100;
  let inserted = 0;

  for (let i = 0; i < geojson.features.length; i += BATCH_SIZE) {
    const batch = geojson.features.slice(i, i + BATCH_SIZE);

    const rows = batch.map((feature, index) => {
      try {
        const wkt = geometryToWKT(feature.geometry);

        return {
          layer_name: layerName,
          layer_title: metadata.title,
          layer_description: metadata.description,
          layer_color: metadata.color,
          properties: feature.properties,
          source_url: metadata.source_url,
          feature_index: i + index,
          geom: `SRID=4326;${wkt}` // PostGIS extended WKT format
        };
      } catch (error) {
        console.warn(`   ⚠️  Skipping feature ${i + index}: ${error instanceof Error ? error.message : error}`);
        return null;
      }
    }).filter(Boolean);

    if (rows.length === 0) {
      continue;
    }

    const { error: insertError, count } = await supabase
      .from('layton_overlays')
      .insert(rows);

    if (insertError) {
      console.error(`   ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, insertError.message);
      throw insertError;
    }

    inserted += rows.length;
    console.log(`   ✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${rows.length} features`);

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`   ✅ Total inserted: ${inserted}/${geojson.features.length} features`);
}

/**
 * Main function
 */
async function main() {
  console.log('🗺️  Uploading Layton City overlays to Supabase...\n');

  const dataDir = path.join(process.cwd(), 'data', 'layton-overlays');

  // Check if data directory exists
  if (!fs.existsSync(dataDir)) {
    console.error(`❌ Data directory not found: ${dataDir}`);
    console.error('   Run fetch-layton-overlays.ts first');
    process.exit(1);
  }

  // Read summary file
  const summaryPath = path.join(dataDir, '_summary.json');
  if (!fs.existsSync(summaryPath)) {
    console.error(`❌ Summary file not found: ${summaryPath}`);
    console.error('   Run fetch-layton-overlays.ts first');
    process.exit(1);
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const successfulLayers = summary.layers.filter((l: any) => !l.error && l.filename);

  console.log(`📊 Found ${successfulLayers.length} layers to upload:\n`);
  successfulLayers.forEach((l: any) => {
    console.log(`   - ${l.title} (${l.feature_count} features)`);
  });

  // Upload each layer
  for (const layer of successfulLayers) {
    const filepath = path.join(dataDir, layer.filename);

    try {
      const geojson: GeoJSONCollection = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      await uploadLayer(geojson);
    } catch (error) {
      console.error(`❌ Failed to upload ${layer.title}:`, error);
    }
  }

  console.log(`\n✅ Upload complete!`);
  console.log(`\n🚀 Next steps:`);
  console.log(`   1. Query the data: SELECT layer_name, COUNT(*) FROM layton_overlays GROUP BY layer_name;`);
  console.log(`   2. Test the RPC function: SELECT * FROM layton_overlays_in_bounds('<bbox_wkt>');`);
  console.log(`   3. Add overlay toggles to your map UI`);
}

main().catch(console.error);
