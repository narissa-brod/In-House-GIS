# Importing KMZ General Plans

Complete guide for adding general plan/land use layers from KMZ files.

---

## Quick Start

```bash
# 1. Convert KMZ to GeoJSON
ogr2ogr -f GeoJSON -t_srs EPSG:4326 general_plan.geojson your_file.kmz

# 2. Run the migration (first time only)
# Connect to Supabase and run: supabase/migrations/006_create_general_plan_table.sql

# 3. Import to database
npm run import-general-plan -- general_plan.geojson

# 4. Add layer to map (see "Adding to Map" section below)
```

---

## Step-by-Step Guide

### 1. Convert KMZ to GeoJSON

**Option A: Using GDAL (recommended)**
```bash
# Install GDAL
# Windows: OSGeo4W or Conda
# Mac: brew install gdal
# Linux: apt-get install gdal-bin

# Convert
ogr2ogr -f GeoJSON -t_srs EPSG:4326 davis_general_plan.geojson davis_gp.kmz
```

**Option B: Online converter**
- Go to https://mygeodata.cloud/converter/kmz-to-geojson
- Upload your KMZ file
- Download GeoJSON

**Option C: Google Earth Pro**
- Open KMZ in Google Earth Pro
- Right-click layer → Save Place As → KML
- Convert KML to GeoJSON using GDAL

### 2. Run Database Migration

```bash
# In Supabase dashboard, run the migration file
# OR use Supabase CLI:
supabase db push
```

Or manually run `supabase/migrations/006_create_general_plan_table.sql` in SQL Editor.

### 3. Import GeoJSON Data

```bash
npm run import-general-plan -- path/to/general_plan.geojson
```

The script will:
- Auto-detect county from filename
- Infer zone types (residential, commercial, etc.)
- Import all polygons to `general_plan` table
- Show stats breakdown by zone type

### 4. Verify Import

```sql
-- Check in Supabase SQL Editor
SELECT
  county,
  zone_type,
  COUNT(*) as count
FROM general_plan
GROUP BY county, zone_type
ORDER BY county, count DESC;
```

---

## Adding General Plan Layer to Map

Add to `src/components/Map.vue`:

### Option 1: As Vector Tiles (Recommended for many zones)

**A. Export and build tiles**
```bash
# Create export script similar to export-parcels-geojson.ts
npm run export-general-plan-geojson
npm run build-general-plan-tiles
```

**B. Add MVTLayer to Map.vue**
```typescript
// Add after parcel layer
const generalPlanLayer = new MVTLayer({
  id: 'general-plan-tiles',
  data: '/tiles/general_plan/{z}/{x}/{y}.pbf',
  pickable: true,
  getFillColor: (d) => getZoneColor(d.properties.zone_type),
  getLineColor: [100, 100, 100, 200],
  lineWidthMinPixels: 1,
  opacity: 0.5,
  onClick: (info) => {
    // Show zone info popup
  }
});
```

### Option 2: As Live GeoJSON (Simpler, good for <1000 zones)

```typescript
// In updateDeckLayers() function
async function updateGeneralPlanLayer() {
  const bounds = map.value.getBounds();
  const bbox = `POLYGON((${sw.lng()} ${sw.lat()}, ...))`;

  const { data } = await supabase
    .rpc('general_plan_in_bounds', { bbox_wkt: bbox })
    .limit(5000);

  const features = data.map(zone => ({
    type: 'Feature',
    geometry: JSON.parse(zone.geom),
    properties: {
      zone_name: zone.zone_name,
      zone_type: zone.zone_type,
      // ... other props
    }
  }));

  const generalPlanLayer = new GeoJsonLayer({
    id: 'general-plan-layer',
    data: { type: 'FeatureCollection', features },
    pickable: true,
    stroked: true,
    filled: true,
    getFillColor: (d) => getZoneColor(d.properties.zone_type),
    getLineColor: [100, 100, 100, 200],
    getLineWidth: 2,
    opacity: 0.5,
    onClick: (info) => showZonePopup(info.object.properties)
  });

  return generalPlanLayer;
}
```

### Color Scheme Helper

```typescript
function getZoneColor(zoneType: string): [number, number, number, number] {
  const colors: Record<string, [number, number, number, number]> = {
    'residential': [255, 242, 0, 100],    // Yellow
    'commercial': [237, 28, 36, 100],     // Red
    'industrial': [136, 0, 136, 100],     // Purple
    'agricultural': [34, 177, 76, 100],   // Green
    'mixed-use': [255, 127, 39, 100],     // Orange
    'open-space': [163, 196, 143, 100],   // Light green
    'public': [63, 72, 204, 100],         // Blue
    'other': [128, 128, 128, 80]          // Gray
  };

  return colors[zoneType] || colors['other'];
}
```

### Add Toggle Control

In Map.vue template:
```vue
<label style="...">
  <input
    type="checkbox"
    v-model="showGeneralPlan"
    @change="toggleGeneralPlan"
  />
  <span>General Plan</span>
</label>
```

---

## Troubleshooting

**Empty import / 0 features**
- Check that GeoJSON has valid `features` array
- Verify coordinate system is EPSG:4326 (WGS84)
- Use `ogr2ogr -t_srs EPSG:4326` to reproject

**Zone types all showing as 'other'**
- Edit the `inferZoneType()` function in import script
- Add custom mappings for your specific zone names

**Import fails with geometry error**
- KMZ might have invalid geometries
- Try fixing with: `ogr2ogr -f GeoJSON -makevalid output.geojson input.kmz`

**Layer not showing on map**
- Check browser console for errors
- Verify data exists: `SELECT COUNT(*) FROM general_plan;`
- Ensure opacity > 0 in layer config

---

## Example: Davis County General Plan

```bash
# 1. Convert your KMZ
ogr2ogr -f GeoJSON -t_srs EPSG:4326 \
  davis_general_plan.geojson \
  Davis_County_General_Plan.kmz

# 2. Import (script auto-detects "Davis" from filename)
npm run import-general-plan -- davis_general_plan.geojson

# Output:
# ✅ Found 245 features
# 🗺️  County detected: Davis
# ✅ Successfully imported 245 general plan zones!
# 📊 Zone type breakdown:
#    residential: 120
#    commercial: 45
#    industrial: 30
#    agricultural: 25
#    mixed-use: 15
#    open-space: 10
```

---

## Next Steps

1. **Import your KMZ** following steps above
2. **Verify data** in Supabase dashboard
3. **Add layer to map** using Option 1 or 2
4. **Style zones** with color scheme
5. **Add popup** showing zone details on click

The pattern is the same for:
- Zoning overlays
- Flood zones
- School districts
- Any other polygon layer from KMZ/KML
