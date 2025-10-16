import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Checking zones with "business" in the name\n');

const { data, error } = await supabase
  .from('general_plan')
  .select('zone_name, zone_code, zone_type, city')
  .limit(1000);

if (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}

const businessZones = data?.filter(z => {
  const text = [z.zone_name, z.zone_code, z.zone_type].join(' ').toLowerCase();
  return text.includes('business');
}) || [];

console.log('=== ZONES WITH "BUSINESS" ===\n');
businessZones.forEach(z => {
  const label = z.zone_name || z.zone_code || z.zone_type || 'NULL';
  console.log(`  ${z.city || 'N/A'}: ${label}`);
});

console.log(`\n\nTotal: ${businessZones.length} zones with "business"`);

// Also check for "professional"
const professionalZones = data?.filter(z => {
  const text = [z.zone_name, z.zone_code, z.zone_type].join(' ').toLowerCase();
  return text.includes('professional');
}) || [];

if (professionalZones.length > 0) {
  console.log('\n\n=== ZONES WITH "PROFESSIONAL" ===\n');
  professionalZones.forEach(z => {
    const label = z.zone_name || z.zone_code || z.zone_type || 'NULL';
    console.log(`  ${z.city || 'N/A'}: ${label}`);
  });
  console.log(`\n\nTotal: ${professionalZones.length} zones with "professional"`);
}
