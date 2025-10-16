import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Checking what zone names are classified as "Other"\n');

const { data: otherZones, error } = await supabase
  .from('general_plan')
  .select('zone_name, zone_code, city, normalized_category')
  .eq('normalized_category', 'Other')
  .limit(50);

if (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}

console.log(`Found ${otherZones?.length} "Other" zones. Here are some examples:\n`);

const zoneCounts = new Map<string, number>();
otherZones?.forEach(zone => {
  const key = `${zone.zone_name || 'NULL'} (${zone.zone_code || 'NULL'}) - ${zone.city || 'NULL'}`;
  zoneCounts.set(key, (zoneCounts.get(key) || 0) + 1);
});

// Show top 20
Array.from(zoneCounts.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([key, count]) => {
    console.log(`  ${count}x ${key}`);
  });

console.log('\n\n🔍 Now checking zones that ARE classified correctly:\n');

const { data: goodZones, error: goodError } = await supabase
  .from('general_plan')
  .select('zone_name, zone_code, city, normalized_category')
  .neq('normalized_category', 'Other')
  .limit(30);

if (!goodError && goodZones) {
  const categoryMap = new Map<string, string[]>();
  goodZones.forEach(zone => {
    const cat = zone.normalized_category;
    const name = `${zone.zone_name || '?'} (${zone.zone_code || '?'}) [${zone.city || '?'}]`;
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(name);
  });

  categoryMap.forEach((names, cat) => {
    console.log(`\n${cat}:`);
    names.slice(0, 5).forEach(name => console.log(`  - ${name}`));
  });
}
