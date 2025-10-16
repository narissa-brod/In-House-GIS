import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🧪 Testing New GP Filter Strategy (ST_Union)\n');

const testCases = [
  { name: 'Residential Low Density', zones: ['Residential Low Density'] },
  { name: 'Commercial', zones: ['Commercial'] },
  { name: 'Parks & Recreation', zones: ['Parks & Recreation'] },
  { name: 'All Residential', zones: ['Residential Low Density', 'Residential Medium Density', 'Residential High Density'] },
  { name: 'Residential + Commercial', zones: ['Residential Low Density', 'Commercial'] },
];

for (const testCase of testCases) {
  console.log(`\n📍 Testing: ${testCase.name}`);
  console.log(`   Zones: ${testCase.zones.join(', ')}`);

  const start = Date.now();
  const { data, error } = await supabase.rpc('search_parcels', {
    gp_zones: testCase.zones,
    county_filter: 'Davis',
    result_limit: 5000
  });
  const duration = Date.now() - start;

  if (error) {
    console.log(`   ❌ Error: ${error.message}`);
  } else {
    console.log(`   ✅ Found ${data?.length || 0} parcels in ${duration}ms`);
    if (data && data.length > 0) {
      console.log(`      Sample: ${data[0].address || data[0].apn} (${data[0].city})`);
    }
  }
}

console.log('\n\n🔍 Checking GP zone counts by category:');
const { data: gpStats, error: gpError } = await supabase
  .from('general_plan')
  .select('normalized_category')
  .limit(1000);

if (!gpError && gpStats) {
  const counts = new Map<string, number>();
  gpStats.forEach(row => {
    const cat = row.normalized_category || 'NULL';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  });

  console.log('\nCategory Distribution:');
  Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count} zones`);
    });
}

console.log('\n✅ Test complete!');
