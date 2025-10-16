import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Checking West Point and Syracuse GP Normalization\n');

// Check West Point
console.log('=== WEST POINT ===');
const { data: wpZones, error: wpError } = await supabase
  .from('general_plan')
  .select('zone_name, zone_code, zone_type, normalized_category')
  .ilike('city', '%WEST POINT%')
  .limit(20);

if (wpError) {
  console.error('❌ Error:', wpError);
} else if (!wpZones || wpZones.length === 0) {
  console.log('⚠️  No West Point zones found in database!');
} else {
  console.log(`Found ${wpZones.length} West Point zones:\n`);
  wpZones.forEach(z => {
    console.log(`  ${z.zone_name || z.zone_code || z.zone_type || 'NULL'} → ${z.normalized_category}`);
  });

  // Count by category
  const wpCounts = new Map<string, number>();
  wpZones.forEach(z => {
    const cat = z.normalized_category || 'NULL';
    wpCounts.set(cat, (wpCounts.get(cat) || 0) + 1);
  });
  console.log('\nWest Point Category Distribution:');
  wpCounts.forEach((count, cat) => console.log(`  ${cat}: ${count}`));
}

// Check Syracuse
console.log('\n\n=== SYRACUSE ===');
const { data: syrZones, error: syrError } = await supabase
  .from('general_plan')
  .select('zone_name, zone_code, zone_type, normalized_category')
  .ilike('city', '%SYRACUSE%')
  .limit(20);

if (syrError) {
  console.error('❌ Error:', syrError);
} else if (!syrZones || syrZones.length === 0) {
  console.log('⚠️  No Syracuse zones found in database!');
} else {
  console.log(`Found ${syrZones.length} Syracuse zones:\n`);
  syrZones.forEach(z => {
    console.log(`  ${z.zone_name || z.zone_code || z.zone_type || 'NULL'} → ${z.normalized_category}`);
  });

  // Count by category
  const syrCounts = new Map<string, number>();
  syrZones.forEach(z => {
    const cat = z.normalized_category || 'NULL';
    syrCounts.set(cat, (syrCounts.get(cat) || 0) + 1);
  });
  console.log('\nSyracuse Category Distribution:');
  syrCounts.forEach((count, cat) => console.log(`  ${cat}: ${count}`));
}

// Check all cities
console.log('\n\n=== ALL CITIES ===');
const { data: allCities, error: citiesError } = await supabase
  .from('general_plan')
  .select('city')
  .not('city', 'is', null);

if (!citiesError && allCities) {
  const cityCounts = new Map<string, number>();
  allCities.forEach(row => {
    const city = row.city || 'NULL';
    cityCounts.set(city, (cityCounts.get(city) || 0) + 1);
  });

  console.log('GP Zones by City:');
  Array.from(cityCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([city, count]) => console.log(`  ${city}: ${count} zones`));
}
