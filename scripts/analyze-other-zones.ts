import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Analyzing "Other" zones to create proper categories\n');

const { data: otherZones, error } = await supabase
  .from('general_plan')
  .select('zone_name, zone_code, zone_type, city')
  .eq('normalized_category', 'Other')
  .limit(500);

if (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}

console.log(`Found ${otherZones?.length} "Other" zones. Analyzing patterns...\n`);

// Group by zone_name
const byName = new Map<string, { count: number; cities: Set<string> }>();
otherZones?.forEach(z => {
  const key = z.zone_name || z.zone_code || z.zone_type || 'NULL';
  if (!byName.has(key)) {
    byName.set(key, { count: 0, cities: new Set() });
  }
  const entry = byName.get(key)!;
  entry.count++;
  if (z.city) entry.cities.add(z.city);
});

console.log('=== TOP "Other" ZONES ===\n');
Array.from(byName.entries())
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 30)
  .forEach(([name, info]) => {
    const cities = Array.from(info.cities).join(', ') || 'N/A';
    console.log(`${info.count}x "${name}" (${cities})`);
  });

// Look for patterns in zone_type
console.log('\n\n=== BY ZONE_TYPE ===\n');
const byType = new Map<string, number>();
otherZones?.forEach(z => {
  const type = z.zone_type || 'NULL';
  byType.set(type, (byType.get(type) || 0) + 1);
});

Array.from(byType.entries())
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => {
    console.log(`${count}x zone_type="${type}"`);
  });

// Sample some actual records
console.log('\n\n=== SAMPLE RECORDS ===\n');
otherZones?.slice(0, 20).forEach((z, i) => {
  console.log(`${i + 1}. name="${z.zone_name || 'NULL'}" code="${z.zone_code || 'NULL'}" type="${z.zone_type || 'NULL'}" city="${z.city || 'NULL'}"`);
});
