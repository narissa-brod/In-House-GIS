# Layton City Overlay Layers Setup Guide

This guide shows you how to add Layton City overlay layers (geology, development agreements, etc.) to your GIS map.

## Overview

We're adding 3 overlay layers from Layton City's ArcGIS services:

1. **Debris Hazards** (63 features) - Orange
2. **Geological Faults** (30 features) - Purple
3. **Development Agreements** (113 features) - Blue

Total: **206 features** stored as GeoJSON in Supabase.

## Step 1: Create Supabase Table

Run the SQL migration in your Supabase SQL Editor:

```bash
# Open this file and copy/paste into Supabase SQL Editor
scripts/create-overlays-table.sql
```

This creates:
- `layton_overlays` table with PostGIS geometry column
- Spatial index for fast queries
- RPC functions for bbox queries
- Row-level security policies

**Verify it worked:**
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'layton_overlays';
```

## Step 2: Fetch GeoJSON Data (Already Done!)

✅ **This step is complete!** The GeoJSON files are already downloaded in:

```
data/layton-overlays/
├── debris_hazards.geojson (63 features)
├── faults.geojson (30 features)
├── development_agreements.geojson (113 features)
└── _summary.json
```

If you need to re-fetch the data:
```bash
npx tsx scripts/fetch-layton-overlays.ts
```

## Step 3: Upload to Supabase

Run the upload script:

```bash
npx tsx scripts/upload-overlays-to-supabase.ts
```

This will:
1. Clear existing data for each layer
2. Convert GeoJSON to PostGIS format
3. Batch insert features (100 at a time)
4. Show progress for each layer

**Verify the upload:**
```sql
SELECT layer_name, layer_title, COUNT(*) as feature_count
FROM layton_overlays
GROUP BY layer_name, layer_title
ORDER BY layer_name;
```

Expected result:
```
debris_hazards     | Geology - Debris Hazards | 63
faults             | Geology - Faults         | 30
development_agreements | Development Agreements  | 113
```

## Step 4: Test the Data

### Query all layers:
```sql
SELECT id, layer_name, layer_title, layer_color
FROM layton_overlays
LIMIT 10;
```

### Query with bounding box (Layton area):
```sql
SELECT * FROM layton_overlays_in_bounds(
  'POLYGON((-112.0 41.0, -111.9 41.0, -111.9 41.1, -112.0 41.1, -112.0 41.0))'
);
```

### Get GeoJSON for a specific layer:
```sql
SELECT get_layer_geojson('debris_hazards');
```

## Step 5: Add to Your Map (Next Step)

Now you need to:

1. **Add Supabase functions** to `src/lib/supabase.ts`:
   - `fetchLaytonOverlays(bounds, layerName?)` - Fetch overlays in viewport
   - `fetchAllLaytonOverlays()` - Fetch all overlays for a layer

2. **Add overlay toggle UI** to `Map.vue`:
   - Checkboxes for each layer
   - Color-coded indicators
   - Show/hide functionality

3. **Render overlays with deck.gl**:
   - Use `GeoJsonLayer` for polygon rendering
   - Apply colors from the database
   - Add tooltips with feature properties

## Layer Details

### Debris Hazards (Orange #ffa500)
- **Features**: 63 polygons
- **Purpose**: Shows debris flow and hazard zones
- **Use case**: Risk assessment for land acquisition

### Geological Faults (Purple #8b00ff)
- **Features**: 30 polylines
- **Purpose**: Known fault lines in the area
- **Use case**: Seismic risk evaluation

### Development Agreements (Blue #4169e1)
- **Features**: 113 polygons
- **Purpose**: Active development agreement areas
- **Use case**: Understanding existing development obligations

## Data Source

All data comes from Layton City's official ArcGIS REST API:
- Base URL: `https://www.laytoncity.org/arcgis109/rest/services/`
- Format: GeoJSON (EPSG:4326 / WGS84)
- Updated: October 2025

## Troubleshooting

### "Table does not exist" error
→ Run `scripts/create-overlays-table.sql` in Supabase SQL Editor first

### "No data directory found"
→ Run `npx tsx scripts/fetch-layton-overlays.ts` to download GeoJSON files

### "Missing Supabase credentials"
→ Check your `.env` file has `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_KEY`

### Upload fails with geometry errors
→ Check the GeoJSON files are valid. The script handles most geometry types automatically.

## Performance Notes

- **Spatial Index**: Enabled on `geom` column for fast bbox queries
- **Batch Size**: 100 features per insert
- **Total Size**: ~206 features = lightweight, no performance concerns
- **Caching**: Consider caching overlay data in-memory after first load

## Next Steps

See the code examples in the next section for adding these overlays to your Map.vue component!
