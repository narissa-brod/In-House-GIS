import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Checking Layton Open Space / Public Facilities zones\n');

const { data, error } = await supabase
  .from('general_plan')
  .select('zone_name, zone_code, zone_type, normalized_category')
  .ilike('city', '%layton%')
  .limit(500);

if (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}

const openSpaceZones = data?.filter(z => {
  const text = [z.zone_name, z.zone_code, z.zone_type].join(' ').toLowerCase();
  return text.includes('open space') || text.includes('public facilities');
}) || [];

console.log('=== LAYTON OPEN SPACE / PUBLIC FACILITIES ===\n');
openSpaceZones.forEach(z => {
  const label = z.zone_name || z.zone_code || z.zone_type || 'NULL';
  console.log(`  "${label}" → Currently: ${z.normalized_category}`);
});

console.log(`\n\nTotal: ${openSpaceZones.length} zones`);

// Show all Layton zone types for reference
console.log('\n\n=== ALL LAYTON ZONE TYPES (sample) ===\n');
const uniqueTypes = new Set<string>();
data?.forEach(z => {
  const label = z.zone_name || z.zone_code || z.zone_type || 'NULL';
  uniqueTypes.add(`${label} → ${z.normalized_category}`);
});

Array.from(uniqueTypes).slice(0, 20).forEach(t => console.log(`  ${t}`));
