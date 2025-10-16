import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const migrationSQL = readFileSync('supabase/migrations/025_add_gp_filter_to_search.sql', 'utf-8');

console.log('Running migration...');

const { data, error } = await supabase.rpc('exec_sql', { sql_query: migrationSQL }).catch(async () => {
  // If exec_sql doesn't exist, try direct execution
  console.log('Using alternative execution method...');
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`
    },
    body: JSON.stringify({ query: migrationSQL })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return { data: await response.json(), error: null };
});

if (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}

console.log('Migration completed successfully!');
console.log(data);
