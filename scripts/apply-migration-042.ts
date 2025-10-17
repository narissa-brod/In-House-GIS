import * as fs from 'fs';

async function applyMigration() {
  console.log('📝 Migration 042: Use spatial city filter with normalized names\n');
  console.log('⚠️  This migration needs to be applied manually via Supabase SQL Editor\n');

  const sql = fs.readFileSync('supabase/migrations/042_use_spatial_city_filter.sql', 'utf-8');

  console.log('🔧 What this fixes:');
  console.log('   - City names are now matched case-insensitively');
  console.log('   - "LAYTON" will match "Layton" in the municipal_boundaries table');
  console.log('   - Parcels without city attributes will still be found via spatial intersection');
  console.log('   - This fixes the 0 results issue when searching with uppercase city names\n');

  console.log('📋 Steps to apply:');
  console.log('   1. Go to your Supabase project: https://xgeeohpgsdkvuukuaosl.supabase.co');
  console.log('   2. Navigate to SQL Editor');
  console.log('   3. Copy and paste the following SQL:');
  console.log('   4. Click "Run"\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(sql);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('✅ After running, test with your search parameters:');
  console.log('   { cities: ["LAYTON"], min_acres: 1, prop_classes: ["Vacant", "Residential"] }');
  console.log('   You should now get ~88 parcels instead of 0!\n');
}

applyMigration()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
