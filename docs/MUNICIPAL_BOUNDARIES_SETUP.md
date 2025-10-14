# Municipal Boundaries Setup Guide

This guide explains how to populate the `municipal_boundaries` table with Davis County city boundaries from Utah AGRC (Automated Geographic Reference Center).

## Overview

The municipal boundaries table enables **spatial city matching** for parcels that lack city attributes. When a parcel search filters by city but the parcel's `city` field is `NULL`, the system can fall back to checking if the parcel's geometry intersects with a municipal boundary polygon.

## Prerequisites

1. Node.js and npm installed
2. Supabase project with PostGIS enabled
3. Service key with write access to the database
4. Environment variables configured in `.env`:
   - `VITE_SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`

## Setup Steps

### Step 1: Run the Migration

The migration creates the RPC function needed for batch inserting boundaries.

**Option A: Using Supabase SQL Editor (Recommended)**

1. Open your Supabase SQL Editor:
   ```
   https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new
   ```

2. Copy and paste the contents of:
   ```
   supabase/migrations/023_create_insert_municipal_boundaries_function.sql
   ```

3. Click "Run" to execute the migration.

**Option B: Using Supabase CLI**

```powershell
cd c:\Dev\In-House-GIS
supabase db push
```

Note: If you encounter conflicts with existing triggers, you may need to use the SQL Editor method instead.

### Step 2: Populate the Boundaries

Run the population script:

```powershell
npm run populate-municipal-boundaries
```

This script will:
1. Fetch municipal boundaries for all 15 Davis County cities from Utah AGRC
2. Clear any existing Davis County boundaries from the table
3. Insert the new boundary polygons in a single batch transaction
4. Verify the insertion was successful

Expected output:
```
Starting municipal boundaries population...

Fetching municipal boundaries for 15 Davis County cities...
  Fetched 15 municipal boundaries so far...

Fetched 15 municipal boundary features

Clearing existing Davis County municipal_boundaries...
Preparing municipal boundaries for batch insert...

  ✓ Prepared Bountiful (BOUNTIFUL)
  ✓ Prepared Centerville (CENTERVILLE)
  ...

Inserting 15 municipal boundaries via RPC...

Successfully inserted 15 municipal boundaries

Verification: municipal_boundaries table now contains 15 records

✅ Municipal boundaries population complete!
```

## How It Works

### Data Source

The script fetches from:
```
https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahMunicipalBoundaries/FeatureServer/0
```

This is the official Utah AGRC Municipal Boundaries service, which provides authoritative boundary polygons for all Utah municipalities.

### Davis County Cities

The script populates boundaries for these 15 cities:
- Bountiful
- Centerville
- Clearfield
- Clinton
- Farmington
- Fruit Heights
- Kaysville
- Layton
- North Salt Lake
- South Weber
- Sunset
- Syracuse
- West Bountiful
- West Point
- Woods Cross

### Database Schema

The `municipal_boundaries` table structure:
```sql
CREATE TABLE public.municipal_boundaries (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  name_norm text GENERATED ALWAYS AS (public.norm_place_name(name)) STORED,
  muni_type text,
  source text DEFAULT 'Utah AGRC UtahMunicipalBoundaries',
  geom geometry(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX municipal_boundaries_gix ON public.municipal_boundaries USING gist (geom);
CREATE INDEX municipal_boundaries_name_norm_idx ON public.municipal_boundaries (name_norm);
```

### Spatial Matching

The `search_parcels` function uses these boundaries as a fallback:

```sql
-- City filter: attribute or spatial boundary match
AND (
  norm_cities IS NULL OR
  -- First try: match by city attribute
  (b.city_norm IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(norm_cities) c WHERE b.city_norm LIKE c || '%'
  )) OR
  -- Fallback: match by spatial intersection
  EXISTS (
    SELECT 1
    FROM public.municipal_boundaries mb
    WHERE mb.name_norm = ANY(norm_cities)
      AND ST_Intersects(b.geom, mb.geom)
  )
)
```

## Maintenance

### Re-run the Script

You can safely re-run the population script at any time to refresh the boundaries:

```powershell
npm run populate-municipal-boundaries
```

The script automatically clears existing Davis County entries before inserting new ones.

### Update Frequency

Municipal boundaries change infrequently (typically only when cities annex new territory). Consider re-running:
- Annually for routine updates
- After major annexation events
- When AGRC publishes boundary updates

## Troubleshooting

### Error: "Could not find the function"

The RPC function hasn't been created yet. Run Step 1 (migration) first.

### Error: "Failed to fetch municipal boundaries"

Check your internet connection. The script fetches from Utah AGRC's public service.

### No features found

Verify that the city names in `DAVIS_COUNTY_CITIES` match the official names in the AGRC service. The script uses case-insensitive LIKE matching to handle variations.

### Permission denied

Ensure your `SUPABASE_SERVICE_KEY` has write access to the `municipal_boundaries` table.

## Performance Impact

- **Table size**: ~15 records (one per city)
- **Geometry complexity**: Each city boundary is a MultiPolygon with hundreds to thousands of vertices
- **Query performance**: GIST index on `geom` ensures fast spatial queries
- **Search impact**: Spatial fallback only executes when:
  1. User filters by city
  2. Parcel has no city attribute
  3. Parcel geometry intersects a selected city boundary

## Related Files

- **Script**: [scripts/populate-municipal-boundaries.ts](../scripts/populate-municipal-boundaries.ts)
- **Migration**: [supabase/migrations/023_create_insert_municipal_boundaries_function.sql](../supabase/migrations/023_create_insert_municipal_boundaries_function.sql)
- **Table creation**: [supabase/migrations/019_create_municipal_boundaries.sql](../supabase/migrations/019_create_municipal_boundaries.sql)
- **Search function**: [supabase/migrations/022_refine_prop_class_matching.sql](../supabase/migrations/022_refine_prop_class_matching.sql)

## Benefits

1. **Reduces false negatives**: Finds parcels even when city attributes are missing
2. **Eliminates client-side fetching**: No need to fetch AGRC boundaries at search time
3. **Faster searches**: Database-level spatial matching is faster than client-side
4. **More reliable**: No dependency on external service availability during searches
5. **Consistent results**: Same boundaries used for all searches
