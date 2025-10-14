/**
 * Helper script to run migration 023 directly
 * This creates the insert_municipal_boundaries RPC function
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/run-migration-023.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL as string;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY as string;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function runMigration() {
  console.log('Reading migration file...');
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '023_create_insert_municipal_boundaries_function.sql');
  const sql = readFileSync(migrationPath, 'utf-8');

  console.log('Executing migration 023...\n');

  // Execute the SQL using a direct query
  // Note: Supabase's rpc() method doesn't support arbitrary SQL execution for security
  // We'll need to use the REST API directly with the service key
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    },
    body: JSON.stringify({ query: sql })
  });

  if (!response.ok) {
    // If exec endpoint doesn't exist, provide manual instructions
    console.log('Could not execute migration automatically.');
    console.log('\nPlease run the following SQL in your Supabase SQL Editor:');
    console.log('='.repeat(80));
    console.log(sql);
    console.log('='.repeat(80));
    console.log('\nOr visit: https://supabase.com/dashboard/project/xgeeohpgsdkvuukuaosl/sql');
    return;
  }

  console.log('✅ Migration 023 executed successfully!');
}

runMigration().catch(console.error);
