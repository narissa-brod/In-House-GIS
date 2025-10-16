/**
 * Helper script to run migration 039 directly.
 * Applies refined West Point General Plan normalization logic.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/run-migration-039.ts
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
  console.log('Reading migration 039 SQL...');
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '039_fix_westpoint_po_and_p.sql');
  const sql = readFileSync(migrationPath, 'utf-8');

  console.log('Executing migration 039 (refined West Point GP categories)...\n');

  try {
    const { error } = await supabase.rpc('exec', { query: sql } as any);

    if (error) {
      throw error;
    }

    console.log('Migration 039 executed successfully.');
  } catch (err) {
    console.log('Could not execute migration automatically.');
    console.log('\nPlease run the following SQL in your Supabase SQL Editor:');
    console.log('='.repeat(80));
    console.log(sql);
    console.log('='.repeat(80));
    console.log('\nOr copy the SQL from: supabase/migrations/039_fix_westpoint_po_and_p.sql');
    console.log('And paste it into: https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new');
  }
}

runMigration().catch(err => {
  console.error('Unexpected error while running migration 039:', err);
  process.exit(1);
});
