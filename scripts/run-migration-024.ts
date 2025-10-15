/**
 * Helper script to run migration 024 directly
 * This adds year built filtering to the search_parcels function
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/run-migration-024.ts
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
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '024_add_year_built_search.sql');
  const sql = readFileSync(migrationPath, 'utf-8');

  console.log('Executing migration 024 (adding year built filter to search_parcels)...\n');

  // Try to execute via Supabase client
  try {
    const { data, error } = await supabase.rpc('exec', { query: sql } as any);

    if (error) {
      throw error;
    }

    console.log('✅ Migration 024 executed successfully!');
    console.log('Year built filtering is now available in parcel search.');
  } catch (err) {
    // If exec endpoint doesn't exist, provide manual instructions
    console.log('Could not execute migration automatically.');
    console.log('\nPlease run the following SQL in your Supabase SQL Editor:');
    console.log('='.repeat(80));
    console.log(sql);
    console.log('='.repeat(80));
    console.log('\nOr copy the SQL from: supabase/migrations/024_add_year_built_search.sql');
    console.log('And paste it into: https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new');
  }
}

runMigration().catch(console.error);
