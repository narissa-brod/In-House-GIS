import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env file');
  process.exit(1);
}

console.log('🔗 Connecting to Supabase...');
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '032_restore_gp_filtering.sql');
console.log(`📄 Reading migration: ${migrationPath}`);

const sql = readFileSync(migrationPath, 'utf-8');

console.log('🚀 Executing migration...\n');

// Execute the SQL directly using a raw query
try {
  // For Supabase, we need to execute this through the database connection
  // The best way is to use supabase.rpc() if you have a helper function, or use the REST API

  const { data, error } = await supabase.rpc('query', { query_text: sql }).catch(async (err) => {
    // If that doesn't work, try executing line by line for better error reporting
    console.log('Trying alternative execution method...\n');

    // Split into statements and execute one by one
    const statements = sql
      .split(/;[\r\n]/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--') && s.length > 10);

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];

      // Check if it's a DROP or CREATE FUNCTION
      if (stmt.includes('DROP FUNCTION')) {
        console.log(`  [${i+1}/${statements.length}] Dropping old function...`);
      } else if (stmt.includes('CREATE OR REPLACE FUNCTION')) {
        console.log(`  [${i+1}/${statements.length}] Creating new search_parcels function with GP filtering...`);
      } else if (stmt.includes('COMMENT ON')) {
        console.log(`  [${i+1}/${statements.length}] Adding function comment...`);
      } else {
        console.log(`  [${i+1}/${statements.length}] Executing: ${stmt.substring(0, 60)}...`);
      }

      // Execute using database client
      // Note: This won't actually work with supabase-js client as it doesn't support raw SQL
      // You'll need to use psql or the Supabase dashboard SQL editor
    }

    throw new Error('Migration needs to be run manually via SQL editor or psql');
  });

  if (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }

  console.log('\n✅ Migration completed successfully!');
  console.log('\n📝 Summary:');
  console.log('   - Re-enabled GP zone filtering in search_parcels() function');
  console.log('   - Now uses PostGIS spatial indexing for fast queries');
  console.log('   - Client-side filtering has been removed from Map.vue');

} catch (err: any) {
  console.error('\n❌ Error:', err.message);
  console.log('\n📋 Manual Migration Instructions:');
  console.log('   1. Open your Supabase dashboard');
  console.log('   2. Go to SQL Editor');
  console.log('   3. Copy and paste the contents of:');
  console.log(`      ${migrationPath}`);
  console.log('   4. Run the query\n');
  process.exit(1);
}
