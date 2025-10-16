import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function count(label: string, params: Record<string, any>) {
  const { data, error } = await supabase.rpc('search_parcels', params);
  if (error) {
    console.error(`${label} error:`, error);
    return;
  }
  console.log(`${label}: ${data?.length ?? 0} parcels`);
}

await count('Low Density (no city filter)', {
  gp_zones: ['Residential Low Density'],
  county_filter: 'Davis',
  result_limit: 20000,
});

await count('Low Density (SYRACUSE city filter)', {
  gp_zones: ['Residential Low Density'],
  county_filter: 'Davis',
  cities: ['SYRACUSE'],
  result_limit: 20000,
});

await count('Medium Density (SYRACUSE city filter)', {
  gp_zones: ['Residential Medium Density'],
  county_filter: 'Davis',
  cities: ['SYRACUSE'],
  result_limit: 20000,
});
