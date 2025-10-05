/**
 * Diagnostic script to check parcels table state
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkTable() {
  console.log('🔍 Checking parcels table...\n');

  // Check row count
  const { count, error: countError } = await supabase
    .from('parcels')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('❌ Error checking count:', countError.message);
  } else {
    console.log(`📊 Row count: ${count}`);
  }

  // Get first few rows
  const { data, error: dataError } = await supabase
    .from('parcels')
    .select('id, apn, address, owner_name')
    .limit(5);

  if (dataError) {
    console.error('❌ Error fetching data:', dataError.message);
  } else {
    console.log(`\n📝 Sample rows (first 5):`);
    console.table(data);
  }

  // Check specific APN that's failing
  const { data: apnData, error: apnError } = await supabase
    .from('parcels')
    .select('*')
    .eq('apn', '041000016');

  if (apnError) {
    console.error('❌ Error checking APN:', apnError.message);
  } else {
    console.log(`\n🔎 Checking for duplicate APN '041000016':`);
    console.log(`   Found ${apnData?.length || 0} records`);
    if (apnData && apnData.length > 0) {
      console.table(apnData);
    }
  }
}

checkTable();
