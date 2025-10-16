import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Checking West Point zones in detail\n');

const { data, error } = await supabase
  .from('general_plan')
  .select('zone_name, zone_code, zone_type, normalized_category')
  .ilike('city', '%WEST POINT%')
  .limit(100);

if (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}

console.log('=== WEST POINT ZONES ===\n');

// Group by zone_name
const byName = new Map<string, { category: string; count: number }>();
data?.forEach(z => {
  const name = z.zone_name || z.zone_code || z.zone_type || 'NULL';
  if (!byName.has(name)) {
    byName.set(name, { category: z.normalized_category, count: 0 });
  }
  byName.get(name)!.count++;
});

// Show all zones
Array.from(byName.entries())
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([name, info]) => {
    console.log(`${info.count}x "${name}" → ${info.category}`);
  });

console.log('\n\n=== ISSUES TO FIX ===\n');

// Check for Professional Office
const professionalOffice = data?.filter(z =>
  (z.zone_name || '').toLowerCase().includes('professional')
);
if (professionalOffice && professionalOffice.length > 0) {
  console.log(`Professional Office zones (${professionalOffice.length}):`);
  professionalOffice.forEach(z => {
    console.log(`  "${z.zone_name}" → Currently: ${z.normalized_category}`);
  });
  console.log('  Should be: Industrial');
}

// Check for Parks/Recreation
const parksRec = data?.filter(z => {
  const text = (z.zone_name || z.zone_type || '').toLowerCase();
  return text.includes('park') || text.includes('recreation');
});
if (parksRec && parksRec.length > 0) {
  console.log(`\nParks/Recreation zones (${parksRec.length}):`);
  parksRec.forEach(z => {
    console.log(`  "${z.zone_name}" → Currently: ${z.normalized_category}`);
  });
}
