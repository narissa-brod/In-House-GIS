# LIR (Land Information Records) Migration Guide

## Overview

This guide covers migrating your parcel data from the basic Utah AGRC Parcels API to the **LIR (Land Information Records) API**, which includes critical fields for identifying vacant land and property characteristics.

## What's New in LIR Data?

### Key Fields Added:
- **`prop_class`** - Property classification: `Vacant`, `Residential`, `Commercial`, `Industrial`, `Mixed`, `Agricultural`, `Open Space`, `Other`
- **`bldg_sqft`** - Building square footage (NULL or 0 for vacant land)
- **`built_yr`** - Year built (NULL for vacant land)
- **`parcel_acres`** - Precise parcel acreage
- **`total_mkt_value`** - Total market value (land + improvements)
- **`land_mkt_value`** - Land value only
- **`house_cnt`** - Number of housing units
- **`primary_res`** - Primary residence indicator (Y/N/U)
- Additional fields: `taxexempt_type`, `floors_cnt`, `const_material`, `subdiv_name`, `tax_dist`

## Migration Steps

### 1. Run Database Migrations

```bash
# Navigate to your Supabase project dashboard
# Go to SQL Editor and run these migrations in order:

1. supabase/migrations/011_add_lir_fields.sql
2. supabase/migrations/012_update_parcels_in_bbox_lir.sql
3. supabase/migrations/013_create_search_parcels_function.sql
```

Or if using Supabase CLI:

```bash
cd "c:\Dev\In-House-GIS"
supabase db push
```

### 2. Re-import Parcel Data Using LIR API

**Option A: Full Re-sync (Recommended)**

```bash
cd "c:\Dev\In-House-GIS\Shapefile Uploads"

# Clear old data and import from LIR API
python sync_parcels_from_utah_lir_api.py --clear
```

**Option B: Test with Limited Records First**

```bash
# Import first 1000 parcels to test
python sync_parcels_from_utah_lir_api.py --limit 1000 --clear
```

### 3. Verify New Fields

After import, check that new fields are populated:

```sql
-- In Supabase SQL Editor
SELECT
  apn,
  address,
  prop_class,
  bldg_sqft,
  built_yr,
  parcel_acres,
  total_mkt_value
FROM parcels
LIMIT 10;
```

### 4. Test Search Function

Try searching for vacant parcels:

```sql
-- Find vacant parcels 2+ acres
SELECT * FROM search_parcels(
  min_acres := 2.0,
  prop_classes := ARRAY['Vacant']
);

-- Find residential parcels with no buildings under $500k
SELECT * FROM search_parcels(
  prop_classes := ARRAY['Residential'],
  max_value := 500000,
  has_building := false
);
```

## API Differences

### Old API (Basic Parcels)
```
https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Davis/FeatureServer/0
```
- Basic parcel boundaries
- Owner type (Public/Private)
- Address, city, APN
- Limited property details

### New API (LIR)
```
https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Davis_LIR/FeatureServer/0
```
- Everything from basic parcels PLUS:
- Property classification (Vacant, Residential, etc.)
- Building square footage and year built
- Market values (total and land)
- Tax assessment data

## Frontend Updates Needed

After data migration, you'll need to update your frontend to use the new fields. The TypeScript types in `Map.vue` will need to include:

```typescript
interface Parcel {
  // ... existing fields
  prop_class: string | null;
  bldg_sqft: number | null;
  built_yr: number | null;
  parcel_acres: number | null;
  total_mkt_value: number | null;
  land_mkt_value: number | null;
  house_cnt: string | null;
  primary_res: string | null;
}
```

## Usage Examples

### Finding Vacant Land for Development

```sql
-- 2+ acre vacant parcels in Kaysville
SELECT * FROM search_parcels(
  min_acres := 2.0,
  prop_classes := ARRAY['Vacant'],
  cities := ARRAY['Kaysville']
);
```

### Finding Underutilized Residential

```sql
-- Large residential parcels with no/small buildings
SELECT * FROM search_parcels(
  min_acres := 1.0,
  prop_classes := ARRAY['Residential'],
  max_value := 300000,
  has_building := false
);
```

### Agricultural to Residential Conversion Candidates

```sql
-- Agricultural parcels near cities
SELECT * FROM search_parcels(
  prop_classes := ARRAY['Agricultural'],
  cities := ARRAY['Layton', 'Kaysville', 'Farmington']
);
```

## Troubleshooting

### Issue: Migration fails with "column already exists"
**Solution:** Migrations are idempotent - safe to re-run. The script checks if columns exist before adding them.

### Issue: Sync script times out
**Solution:** The API may be slow. Use `--limit` parameter to sync in batches:
```bash
python sync_parcels_from_utah_lir_api.py --limit 5000
```

### Issue: Many NULL values in new fields
**Solution:** This is expected! Not all parcels have complete LIR data. Use filters to handle NULLs:
```sql
WHERE prop_class IS NOT NULL AND prop_class = 'Vacant'
```

## Next Steps

Once data is migrated, you can:
1. ✅ Build custom layer search UI in `App.vue`
2. ✅ Create parcel search criteria builder
3. ✅ Implement custom layer rendering with distinct styling
4. ✅ Add export functionality for matched parcels

## Support

For questions about LIR data fields, contact:
- **Utah AGRC**: https://gis.utah.gov/
- **Davis County Assessor**: (801) 451-3225
