import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Finding parcels that overlap with multiple GP zones\n');

// Search for parcels using Parks & Recreation filter
const { data: parcels, error } = await supabase.rpc('search_parcels', {
  gp_zones: ['Parks & Recreation'],
  county_filter: 'Davis',
  result_limit: 50
});

if (error) {
  console.error('❌ Search error:', error);
  process.exit(1);
}

console.log(`Found ${parcels?.length} parcels in Parks & Recreation\n`);

// Look for residential or school addresses (these shouldn't be in parks)
const suspicious = parcels?.filter(p => {
  const addr = (p.address || '').toLowerCase();
  return addr.includes('school') || p.prop_class?.includes('Residential');
});

console.log(`Found ${suspicious?.length} suspicious parcels (schools or residential):\n`);

suspicious?.slice(0, 10).forEach(p => {
  console.log(`  ${p.address || p.apn} - ${p.city || 'N/A'} - ${p.prop_class}`);
});

console.log('\n\n💡 Analysis:');
console.log('These parcels are likely on the boundary between Parks and Schools/Residential zones.');
console.log('The ST_Intersects query catches ANY overlap, even if just a small edge touches.');
console.log('\nOptions to fix:');
console.log('  1. Use ST_Contains instead of ST_Intersects (only if parcel fully inside GP zone)');
console.log('  2. Use centroid-based matching (only if parcel center is in GP zone)');
console.log('  3. Use area-based threshold (only if >50% of parcel is in GP zone)');
console.log('\nRecommendation: Use centroid-based matching for more accurate results.');
