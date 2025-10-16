import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Detailed check of Layton zones\n');

const { data, error } = await supabase
  .from('general_plan')
  .select('*')
  .ilike('city', '%layton%')
  .limit(30);

if (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}

console.log(`Found ${data?.length} Layton zones. Showing first 30:\n`);

data?.forEach((z, i) => {
  console.log(`\n--- Zone ${i + 1} ---`);
  console.log(`Zone Name: ${z.zone_name || 'NULL'}`);
  console.log(`Zone Code: ${z.zone_code || 'NULL'}`);
  console.log(`Zone Type: ${z.zone_type || 'NULL'}`);
  console.log(`Name: ${z.name || 'NULL'}`);
  console.log(`Description: ${z.description ? z.description.substring(0, 60) : 'NULL'}`);
  console.log(`Normalized: ${z.normalized_category}`);
});
