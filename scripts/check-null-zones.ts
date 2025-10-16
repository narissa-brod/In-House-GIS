import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Checking zones with NULL names\n');

const { data: nullZones, error } = await supabase
  .from('general_plan')
  .select('*')
  .is('zone_name', null)
  .limit(10);

if (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}

console.log(`Found zones with NULL zone_name. Showing first ${nullZones?.length}:\n`);

nullZones?.forEach((zone, i) => {
  console.log(`\n--- Zone ${i + 1} ---`);
  console.log(`ID: ${zone.id}`);
  console.log(`Zone Name: ${zone.zone_name}`);
  console.log(`Zone Code: ${zone.zone_code}`);
  console.log(`Zone Type: ${zone.zone_type}`);
  console.log(`Name: ${zone.name}`);
  console.log(`Description: ${zone.description ? zone.description.substring(0, 100) : 'NULL'}`);
  console.log(`City: ${zone.city}`);
  console.log(`Normalized Category: ${zone.normalized_category}`);
});

console.log('\n\n🔍 Checking if these zones have "name" or "description" fields we can use:\n');

const nameFields = nullZones?.map(z => ({
  name: z.name,
  description: z.description?.substring(0, 50),
  zone_type: z.zone_type
}));

console.table(nameFields);
