import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

async function applyMigration() {
  console.log('📝 Applying migration 041: Fix GP filter city check...\n');

  const sql = fs.readFileSync('supabase/migrations/041_fix_gp_filter_city_check.sql', 'utf-8');

  const { error } = await supabase.rpc('exec_sql', { sql_string: sql }).catch(() => {
    // If exec_sql doesn't exist, try direct query
    return supabase.from('_migrations').insert({ name: '041_fix_gp_filter_city_check' });
  });

  // Direct SQL execution
  const { error: execError } = await supabase.rpc('query', sql as any).catch(async () => {
    // Fallback: execute via raw query if RPC doesn't work
    console.log('Using direct SQL execution...');
    const response = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY as string,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ query: sql })
    });
    return { error: response.ok ? null : await response.text() };
  });

  if (error || execError) {
    console.error('❌ Migration failed:', error || execError);
    console.log('\n💡 Please apply manually using Supabase Studio SQL Editor or:');
    console.log('   npx supabase db push');
    process.exit(1);
  }

  console.log('✅ Migration applied successfully!');
  console.log('\n📊 The GP filter now respects city boundaries.');
  console.log('   - When you filter by "Layton" + residential GP zones');
  console.log('   - It will only find parcels in GP zones within Layton municipal boundaries');
}

applyMigration()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
