/**
 * Sync Davis County LIR fields into parcels (upsert by APN via batch RPC)
 * - Uses AGRC Feature Service: Parcels_Davis_LIR layer 0 (attributes only)
 * - Calls public.batch_update_lir_fields(lir_data jsonb) for fast updates
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/sync-davis-lir.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL as string;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY as string;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const LIR_URL = 'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Davis_LIR/FeatureServer/0/query';

type Attrs = Record<string, any>;

function pick(attrs: Attrs, keys: string[]): any {
  for (const k of keys) {
    if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== '') return attrs[k];
  }
  return undefined;
}

function mapRecord(attrs: Attrs) {
  const apn = String(
    pick(attrs, [
      'ParcelTaxID', 'PARCEL', 'PARCELTAXID', 'PARCEL_ID', 'TAXID', 'TaxID', 'Serial', 'SerialNo', 'PARCELNO'
    ]) || ''
  ).trim();
  if (!apn) return null;

  const rec: Record<string, any> = { apn };
  const set = (key: string, val: any) => {
    if (val !== undefined) rec[key] = val;
  };

  set('prop_class', pick(attrs, ['prop_class', 'PROP_CLASS', 'PROPERTY_CLASS', 'PropertyClass']));
  set('taxexempt_type', pick(attrs, ['TAXEXEMPT_TYPE', 'taxexempt_type']));
  set('primary_res', pick(attrs, ['PRIMARY_RES', 'primary_res']));
  set('bldg_sqft', pick(attrs, ['BLDG_SQFT', 'BLDG_SQFT_TOT', 'BLDGSQFT', 'IMPROVEMENT_AREA', 'bldg_sqft']));
  set('bldg_sqft_info', pick(attrs, ['BLDG_SQFT_INFO', 'bldg_sqft_info']));
  set('floors_cnt', pick(attrs, ['FLOORS_CNT', 'FLOORS', 'floors_cnt']));
  set('floors_info', pick(attrs, ['FLOORS_INFO', 'floors_info']));
  set('built_yr', pick(attrs, ['BUILT_YR', 'YEAR_BUILT', 'YRBLT', 'built_yr']));
  set('effbuilt_yr', pick(attrs, ['EFFBUILT_YR', 'EFF_YEAR_BUILT', 'effbuilt_yr']));
  set('const_material', pick(attrs, ['CONST_MATERIAL', 'CONSTRUCTION', 'const_material']));
  set('total_mkt_value', pick(attrs, ['TOTAL_MKT_VALUE', 'TOTAL_MARKET_VALUE', 'MARKET_VALUE_TOTAL', 'total_mkt_value']));
  set('land_mkt_value', pick(attrs, ['LAND_MKT_VALUE', 'LAND_MARKET_VALUE', 'MARKET_VALUE_LAND', 'land_mkt_value']));
  set('parcel_acres', pick(attrs, ['PARCEL_ACRES', 'PARCEL_ACREAGE', 'ACRES', 'Acreage', 'parcel_acres']));
  set('house_cnt', pick(attrs, ['HOUSE_CNT', 'HOUSE_COUNT', 'NUM_STRUCTURES', 'house_cnt']));
  set('subdiv_name', pick(attrs, ['SUBDIV_NAME', 'SUBDIVISION', 'SUBDIV', 'subdiv_name']));
  set('tax_dist', pick(attrs, ['TAX_DIST', 'TAXDIST', 'TAX_DISTRICT', 'tax_dist']));

  return rec;
}

async function fetchAllLir(): Promise<Attrs[]> {
  const all: Attrs[] = [];
  let offset = 0;
  // Many ArcGIS services cap at 2000 per page
  const page = 2000;
  for (;;) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      returnGeometry: 'false',
      f: 'json',
      resultRecordCount: String(page),
      resultOffset: String(offset)
    });
    const resp = await fetch(`${LIR_URL}?${params.toString()}`);
    if (!resp.ok) throw new Error(`LIR fetch failed: ${resp.status} ${resp.statusText}`);
    const json = await resp.json();
    const features: any[] = json?.features || [];
    if (features.length === 0) break;
    for (const f of features) all.push(f.attributes || f.properties || {});
    // Advance by actual page size returned to avoid early termination
    offset += features.length;
  }
  return all;
}

async function main() {
  console.log('Fetching Davis LIR attributes...');
  const rows = await fetchAllLir();
  console.log(`Fetched ${rows.length} attribute rows`);

  const mapped = rows.map(mapRecord).filter(Boolean) as Record<string, any>[];
  // Drop records with only APN and no other fields
  const cleaned = mapped.filter(r => Object.keys(r).length > 1);
  console.log(`Prepared ${cleaned.length} records for update`);

  const BATCH = 1000;
  let updated = 0;
  for (let i = 0; i < cleaned.length; i += BATCH) {
    const slice = cleaned.slice(i, i + BATCH);
    // Pass JSON array directly; SQL expects jsonb array (not a JSON string)
    const { data, error } = await supabase.rpc('batch_update_lir_fields', { lir_data: slice as any });
    if (error) {
      console.error('Batch update failed:', error.message);
      throw error;
    }
    updated += (data?.[0]?.updated_count ?? 0);
    console.log(`Updated ${updated} rows so far...`);
  }
  console.log(`Done. Updated up to ${updated} parcel rows with LIR fields.`);
}

main().catch(err => { console.error(err); process.exit(1); });
