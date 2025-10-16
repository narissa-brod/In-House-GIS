import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error('Usage: node scripts/run-migration-file.mjs <migration-file-path>');
  process.exit(1);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  console.error('Make sure you have a .env file with these values');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.log(`Reading migration file: ${migrationFile}`);
const migrationSQL = readFileSync(migrationFile, 'utf-8');

console.log('Executing SQL migration...');
console.log('---');

// Split SQL into individual statements
const statements = migrationSQL
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

let successCount = 0;
let errorCount = 0;

for (let i = 0; i < statements.length; i++) {
  const statement = statements[i] + ';';

  // Skip comment-only statements
  if (statement.trim().startsWith('--')) continue;

  try {
    const { error } = await supabase.rpc('exec_sql', { sql_query: statement }).catch(async () => {
      // Fallback: try to execute using raw SQL query
      const { error } = await supabase.from('_sql').select('*').limit(0); // This will fail, but we're just testing connection

      // Direct execution via fetch (last resort)
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ sql_query: statement })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      return { data: await response.json(), error: null };
    });

    if (error) {
      console.error(`❌ Statement ${i + 1} failed:`, error.message);
      console.error('Statement:', statement.substring(0, 100) + '...');
      errorCount++;
    } else {
      console.log(`✓ Statement ${i + 1} executed successfully`);
      successCount++;
    }
  } catch (err) {
    console.error(`❌ Statement ${i + 1} failed:`, err.message);
    console.error('Statement:', statement.substring(0, 100) + '...');
    errorCount++;
  }
}

console.log('---');
console.log(`Migration completed: ${successCount} succeeded, ${errorCount} failed`);

if (errorCount > 0) {
  process.exit(1);
}

console.log('✓ Migration successful!');
