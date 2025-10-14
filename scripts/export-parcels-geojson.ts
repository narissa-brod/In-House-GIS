import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function exportParcelsToGeoJSON() {
  console.log('Exporting parcels from Supabase to GeoJSON...\n');

  // Use a SQL query to get all parcels with geometry as GeoJSON
  const { data, error } = await supabase.rpc('export_all_parcels');

  if (error) {
    console.error('Error:', error);
    console.log('\nYou need to create this function in Supabase SQL Editor:');
    console.log(`
CREATE OR REPLACE FUNCTION export_all_parcels()
RETURNS TABLE (
  id BIGINT,
  apn TEXT,
  address TEXT,
  city TEXT,
  county TEXT,
  zip_code TEXT,
  owner_type TEXT,
  size_acres NUMERIC,
  property_url TEXT,
  prop_class TEXT,
  bldg_sqft NUMERIC,
  built_yr INTEGER,
  parcel_acres NUMERIC,
  total_mkt_value NUMERIC,
  land_mkt_value NUMERIC,
  geom_json TEXT
)
LANGUAGE SQL
AS $$
  SELECT
    id,
    apn,
    address,
    city,
    county,
    zip_code,
    owner_type,
    size_acres,
    property_url,
    prop_class,
    bldg_sqft,
    built_yr,
    parcel_acres,
    total_mkt_value,
    land_mkt_value,
    ST_AsGeoJSON(geom)::TEXT as geom_json
  FROM parcels
  ORDER BY id;
$$;
    `);
    return;
  }

  if (!data || data.length === 0) {
    console.log('No parcels found');
    return;
  }

  console.log(`Fetched ${data.length} parcels`);
  console.log('Converting to GeoJSON FeatureCollection...');

  // Convert to GeoJSON FeatureCollection
  const geojson = {
    type: 'FeatureCollection',
    features: data.map((parcel: any) => ({
      type: 'Feature',
      geometry: JSON.parse(parcel.geom_json),
      properties: {
        id: parcel.id,
        apn: parcel.apn,
        address: parcel.address,
        city: parcel.city,
        county: parcel.county,
        zip_code: parcel.zip_code,
        owner_type: parcel.owner_type,
        size_acres: Number(parcel.size_acres),
        property_url: parcel.property_url,
        // New LIR fields
        prop_class: parcel.prop_class,
        bldg_sqft: parcel.bldg_sqft ? Number(parcel.bldg_sqft) : null,
        built_yr: parcel.built_yr ? Number(parcel.built_yr) : null,
        parcel_acres: parcel.parcel_acres ? Number(parcel.parcel_acres) : null,
        total_mkt_value: parcel.total_mkt_value ? Number(parcel.total_mkt_value) : null,
        land_mkt_value: parcel.land_mkt_value ? Number(parcel.land_mkt_value) : null
      }
    }))
  };

  // Write to file
  const outputPath = './parcels.geojson';
  writeFileSync(outputPath, JSON.stringify(geojson));

  const fileSizeMB = (Buffer.byteLength(JSON.stringify(geojson)) / 1024 / 1024).toFixed(2);

  console.log(`\n✅ Success! Exported ${geojson.features.length} parcels to ${outputPath}`);
  console.log(`📦 File size: ${fileSizeMB} MB`);

  console.log('\n📋 Next steps:');
  console.log('1. Install tippecanoe (if not already installed)');
  console.log('   • macOS: brew install tippecanoe');
  console.log('   • Windows: Use WSL or Docker');
  console.log('');
  console.log('2. Generate vector tiles:');
  console.log('   tippecanoe -o parcels.mbtiles -zg -Z6 -z15 --drop-densest-as-needed parcels.geojson');
  console.log('');
  console.log('3. Extract tiles to directory:');
  console.log('   tile-join -e ./tiles parcels.mbtiles');
  console.log('');
  console.log('4. Upload ./tiles folder to Supabase Storage or Cloudflare R2');
}

exportParcelsToGeoJSON();
