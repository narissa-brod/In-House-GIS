import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Checking NULL zones in Parks & Recreation\n');

const { data, error } = await supabase
  .from('general_plan')
  .select('*')
  .eq('normalized_category', 'Parks & Recreation')
  .is('zone_name', null)
  .limit(10);

if (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}

console.log(`Found ${data?.length} Parks & Recreation zones with NULL zone_name:\n`);

data?.forEach((z, i) => {
  console.log(`--- Zone ${i + 1} ---`);
  console.log(`ID: ${z.id}`);
  console.log(`Zone Name: ${z.zone_name}`);
  console.log(`Zone Code: ${z.zone_code}`);
  console.log(`Zone Type: ${z.zone_type}`);
  console.log(`City: ${z.city}`);
  console.log(`Normalized: ${z.normalized_category}`);
  console.log('');
});

// Check the text that's being matched
console.log('Checking what text is matching the pattern...\n');
data?.forEach((z) => {
  const search_text = `${z.zone_name || ''} ${z.zone_code || ''} ${z.zone_type || ''}`.toLowerCase();
  console.log(`"${search_text}" → ${z.normalized_category}`);
});
