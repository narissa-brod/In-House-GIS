# LIR Data Migration Instructions

## What This Does
Merges Land Information Records (LIR) data into your existing 127,000 parcels:
- Property classification (Vacant, Residential, Commercial, etc.)
- Building details (square footage, year built, floors, construction type)
- Market values (total and land-only)
- Parcel acreage and other property details

This KEEPS all your existing owner data from Davis County GIS Portal intact!

## Option 1: Ultra-Fast (Recommended) - 2-3 minutes

### Step 1: Apply Migration to Supabase

1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste the contents of `supabase/migrations/014_create_batch_update_lir_function.sql`
4. Click "Run" to create the batch update function

### Step 2: Run the Ultra-Fast Update Script

```bash
cd "Shapefile Uploads"

# Test with first 5000 parcels (takes ~30 seconds)
python update_parcels_with_lir_ultra_fast.py --run --limit 5000

# If that works, run the full update (takes ~2-3 minutes)
python update_parcels_with_lir_ultra_fast.py --run
```

## Option 2: Slower Fallback - 30-60 minutes

If Option 1 doesn't work (e.g., migration issues), use the slower script:

```bash
cd "Shapefile Uploads"

# Test with first 1000 parcels (takes ~2 minutes)
python update_parcels_with_lir.py --run --limit 1000

# If successful, run full update (takes 30-60 minutes)
python update_parcels_with_lir.py --run
```

## Verification

After running either script, verify the data was merged:

1. Go to Supabase Table Editor
2. Open the `parcels` table
3. Check a few rows for:
   - `prop_class` should have values like "Vacant", "Residential", etc.
   - `bldg_sqft` should have numbers for parcels with buildings
   - `built_yr` should have years for parcels with structures
   - `total_mkt_value` should have market values

## Troubleshooting

### Error: "supabase_key is required"
- Check that your `.env` file has `VITE_SUPABASE_SERVICE_ROLE_KEY` set
- You can find this in Supabase Dashboard → Settings → API → service_role key

### Error: "could not find function batch_update_lir_fields"
- The migration wasn't applied - go back to Option 1, Step 1
- OR use Option 2 (slower script that doesn't need the function)

### Updates are too slow
- Make sure you're using `update_parcels_with_lir_ultra_fast.py` (Option 1)
- Check your internet connection speed
- Consider using `--limit` flag to update in chunks

## What's Next?

Once the LIR data is merged:
1. TypeScript types in Map.vue will be updated for the new fields
2. Parcel Search UI panel will be built
3. Custom layer rendering for search results will be added

This will let you search for parcels like:
- "Find 2+ acre vacant parcels"
- "Find residential parcels under $500k with no buildings"
- "Find commercial parcels over 5 acres"
