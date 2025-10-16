import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Debugging Parks & Recreation search results\n');

// First, let's see what GP zones are categorized as Parks & Recreation
const { data: parksZones, error: parksError } = await supabase
  .from('general_plan')
  .select('id, zone_name, zone_code, city, normalized_category')
  .eq('normalized_category', 'Parks & Recreation')
  .limit(20);

console.log('=== GP ZONES IN PARKS & RECREATION CATEGORY ===\n');
parksZones?.forEach(z => {
  console.log(`  ${z.city || 'N/A'}: "${z.zone_name || z.zone_code || 'NULL'}"`);
});
console.log(`\nTotal Parks & Recreation zones: ${parksZones?.length || 0}`);

// Now search for parcels using Parks & Recreation filter
const { data: parcels, error } = await supabase.rpc('search_parcels', {
  gp_zones: ['Parks & Recreation'],
  county_filter: 'Davis',
  result_limit: 10
});

if (error) {
  console.error('❌ Search error:', error);
  process.exit(1);
}

console.log('\n\n=== SAMPLE PARCELS FOUND (First 10) ===\n');
parcels?.forEach((p, i) => {
  console.log(`${i + 1}. ${p.address || p.apn} (${p.city})`);
});

// Now check what GP zones these parcels actually intersect with
console.log('\n\n=== CHECKING GP ZONE INTERSECTIONS ===\n');

for (const p of parcels?.slice(0, 5) || []) {
  console.log(`\nParcel: ${p.address || p.apn} (${p.city})`);

  // Find all GP zones this parcel intersects with
  const geom = JSON.parse(p.geom);

  // We can't easily do spatial queries from the client, so let's just show the parcel info
  console.log(`  APN: ${p.apn}`);
  console.log(`  City: ${p.city}`);
  console.log(`  Address: ${p.address || 'N/A'}`);
}

console.log('\n\n💡 The issue might be:');
console.log('  1. Parcels overlap multiple GP zones (e.g., on boundary of School + Parks)');
console.log('  2. GP zone geometries are overlapping');
console.log('  3. A "Schools" or "R-3" zone is accidentally categorized as Parks & Recreation');
console.log('\nCheck the GP zones list above to verify categorization is correct.');
