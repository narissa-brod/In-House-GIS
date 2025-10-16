import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Diagnosing GP Zone Filtering\n');

// Test 1: Check what normalized_category values exist
console.log('📊 Test 1: Checking normalized_category distribution in general_plan table');
const { data: gpCounts, error: gpError } = await supabase
  .from('general_plan')
  .select('normalized_category')
  .limit(1000);

if (gpError) {
  console.error('❌ Error querying general_plan:', gpError);
} else {
  const counts = new Map<string, number>();
  gpCounts?.forEach(row => {
    const cat = row.normalized_category || 'NULL';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  });

  console.log('\nCategories found:');
  Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      console.log(`  - ${cat}: ${count} zones`);
    });
}

// Test 2: Check if there are any parcels in Davis County
console.log('\n\n📊 Test 2: Checking parcels in Davis County');
const { count: parcelCount, error: parcelError } = await supabase
  .from('parcels')
  .select('*', { count: 'exact', head: true })
  .eq('county', 'Davis');

if (parcelError) {
  console.error('❌ Error querying parcels:', parcelError);
} else {
  console.log(`  Found ${parcelCount} parcels in Davis County`);
}

// Test 3: Try the search_parcels function with GP zones
console.log('\n\n📊 Test 3: Testing search_parcels function with GP zones');
const testZones = ['Residential Low Density', 'Commercial', 'Mixed Use'];

for (const zone of testZones) {
  const { data: results, error } = await supabase.rpc('search_parcels', {
    gp_zones: [zone],
    county_filter: 'Davis',
    result_limit: 10
  });

  if (error) {
    console.error(`❌ Error searching for "${zone}":`, error.message);
  } else {
    console.log(`  "${zone}": ${results?.length || 0} parcels found`);
    if (results && results.length > 0) {
      console.log(`    Sample: ${results[0].address || results[0].apn}`);
    }
  }
}

// Test 4: Check a specific parcel's intersection with GP zones
console.log('\n\n📊 Test 4: Testing spatial intersection directly');
const { data: sampleParcels, error: sampleError } = await supabase
  .from('parcels')
  .select('id, apn, address, city')
  .eq('county', 'Davis')
  .not('city', 'is', null)
  .limit(5);

if (!sampleError && sampleParcels && sampleParcels.length > 0) {
  console.log(`\nTesting intersection for ${sampleParcels.length} sample parcels:`);

  for (const parcel of sampleParcels) {
    // Query to check if this parcel intersects with any GP zone
    const { data: intersects, error } = await supabase.rpc('query', {
      query_text: `
        SELECT gp.normalized_category, gp.city
        FROM general_plan gp, parcels p
        WHERE p.id = ${parcel.id}
          AND ST_Contains(gp.geom, ST_Centroid(p.geom))
        LIMIT 1;
      `
    }).catch(() => ({ data: null, error: 'RPC not available' }));

    if (error) {
      console.log(`  ${parcel.apn}: Unable to test (${error})`);
    } else if (intersects && intersects.length > 0) {
      console.log(`  ${parcel.apn} (${parcel.city}): ✓ In ${intersects[0].normalized_category}`);
    } else {
      console.log(`  ${parcel.apn} (${parcel.city}): ✗ No GP zone intersection`);
    }
  }
}

// Test 5: Check if general_plan has geometries
console.log('\n\n📊 Test 5: Checking general_plan geometries');
const { data: gpSample, error: gpSampleError } = await supabase
  .from('general_plan')
  .select('id, city, zone_name, normalized_category')
  .limit(5);

if (gpSampleError) {
  console.error('❌ Error:', gpSampleError);
} else {
  console.log(`\nSample GP zones:`);
  gpSample?.forEach(zone => {
    console.log(`  - ${zone.city || 'N/A'}: ${zone.zone_name} → ${zone.normalized_category}`);
  });
}

console.log('\n\n🔍 Diagnosis Complete!');
console.log('\n💡 Next Steps:');
console.log('  1. Check if normalized_category values match your UI categories');
console.log('  2. Verify GP zones have geometries and cover your parcels');
console.log('  3. Make sure city names match between parcels and GP zones');
