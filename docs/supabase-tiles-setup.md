# Supabase Vector Tiles Setup for Davis County Parcels

This guide explains how to set up and use vector tiles served directly from Supabase for the Davis County parcels layer.

## Overview

Vector tiles are a more efficient way to display large geographic datasets. Instead of loading all parcel geometries as GeoJSON, tiles are generated on-demand for only the visible map area at the current zoom level.

This implementation uses **Supabase Edge Functions** to serve tiles with proper HTTP headers:
- ✅ `Content-Type: application/vnd.mapbox-vector-tile` (correct MIME type)
- ✅ `Content-Encoding: gzip` (compressed for faster delivery)
- ✅ `Cache-Control` headers (browser and CDN caching)

### Benefits of Supabase Tiles

- **No external infrastructure**: Tiles are served directly from your Supabase database
- **Always up-to-date**: Tiles are generated dynamically from live data
- **Cost-effective**: No need for CDN or separate tile server
- **Automatic optimization**: Geometries are simplified based on zoom level
- **Secure**: Uses your existing Supabase authentication
- **Proper format**: Correct content type and gzip compression

## Setup Steps

### 1. Apply Database Migrations

Run the new migrations to create the tile functions:

```bash
# If using Supabase CLI
npx supabase db push

# Or apply migrations manually through Supabase dashboard
# SQL Editor > New Query > paste contents of:
# - supabase/migrations/008_create_parcel_tiles_function.sql
# - supabase/migrations/009_optimize_parcel_tiles.sql
```

### 2. Deploy the Edge Function

Deploy the Edge Function that handles tile serving with proper headers:

```bash
# Deploy the parcels-tile Edge Function
npx supabase functions deploy parcels-tile

# If you need to set secrets (done automatically by CLI):
npx supabase secrets set SUPABASE_URL=https://your-project.supabase.co
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Important**: The Edge Function needs access to your service role key to call the database function. This is set automatically when you deploy.

### 3. Generate Simplified Geometries (Important!)

After importing your parcel data, run this function to create optimized geometries:

```sql
-- Run in Supabase SQL Editor
SELECT update_simplified_geometries();
```

This creates simplified versions of parcel geometries for faster rendering at lower zoom levels. Run this whenever you bulk import new parcels.

### 4. Configure Your Environment

Update your `.env` file with your Supabase Edge Function endpoint:

```env
# Replace YOUR_PROJECT with your actual Supabase project reference
VITE_PARCELS_TILES_URL=https://YOUR_PROJECT.supabase.co/functions/v1/parcels-tile?z={z}&x={x}&y={y}
VITE_PARCELS_TILES_MIN_ZOOM=15
VITE_PARCELS_GEOJSON_MIN_ZOOM=18
```

Example with actual URL:
```env
VITE_PARCELS_TILES_URL=https://abcdefghijklmno.supabase.co/functions/v1/parcels-tile?z={z}&x={x}&y={y}
```

### 5. Enable Public Access (Optional)

Edge Functions are public by default. If you want to restrict access:

```typescript
// In supabase/functions/parcels-tile/index.ts
// Add authentication check:
const authHeader = req.headers.get('Authorization')
if (!authHeader) {
  return new Response('Unauthorized', { status: 401 })
}
```

## How It Works

### Architecture

```
Browser → Supabase Edge Function → Database parcels_tile() → MVT binary
                ↓
         Adds proper headers:
         - Content-Type: application/vnd.mapbox-vector-tile
         - Content-Encoding: gzip
         - Cache-Control: public, max-age=3600
```

### Tile Function (Database)

The `parcels_tile(z, x, y)` PostgreSQL function:

1. Calculates the bounding box for the requested tile using Web Mercator projection
2. Finds all parcels that intersect with that tile
3. Simplifies geometries based on zoom level (more simplification at lower zooms)
4. Generates a Mapbox Vector Tile (MVT) in binary format
5. Returns raw bytea to the Edge Function

### Edge Function

The Edge Function wrapper:

1. Validates tile coordinates (z, x, y)
2. Calls the database `parcels_tile()` function
3. Decodes the bytea response
4. Compresses with gzip
5. Returns with proper HTTP headers

### Zoom-Based Optimization

- **z >= 16**: Full detail, no simplification
- **z 14-15**: Minimal simplification (1m tolerance)
- **z 12-13**: Light simplification (2m tolerance)
- **z < 12**: Aggressive simplification (4m tolerance)

Parcels use `geom_simplified` column at z < 14 for even better performance.

### Map Integration

The app uses deck.gl's MVTLayer to display tiles:

- **z < 15**: No parcels shown (too far out)
- **z 15-17**: Vector tiles from Supabase Edge Function
- **z >= 18**: Live GeoJSON data (for click/interaction)

## Testing Your Setup

### 1. Test Database Function

Test that the database function works:

```sql
-- Run in Supabase SQL Editor
-- This should return binary data (bytea)
SELECT parcels_tile(15, 6517, 11916);
```

### 2. Test Edge Function

Test the Edge Function directly:

```bash
# Using curl
curl "https://YOUR_PROJECT.supabase.co/functions/v1/parcels-tile?z=15&x=6517&y=11916" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -v
```

Check the response headers:
- Status: `200 OK`
- `Content-Type: application/vnd.mapbox-vector-tile`
- `Content-Encoding: gzip`
- `Cache-Control: public, max-age=3600`

### 3. Test in Browser

1. Start your dev server: `npm run dev`
2. Open the app in your browser
3. Open browser DevTools > Network tab
4. Zoom to level 15+ on Davis County
5. Look for requests to `/functions/v1/parcels-tile?z=...`
6. Status should be 200 OK
7. Response headers should show correct content type and encoding

### 4. Check Tile Stats

See how many features are in a specific tile:

```sql
-- Run in Supabase SQL Editor
SELECT * FROM parcels_tile_stats(15, 6517, 11916);
```

This shows:
- `feature_count`: Number of parcels in this tile
- `tile_size_bytes`: Size of the generated tile in bytes

## Troubleshooting

### Tiles Not Loading

**Problem**: Network tab shows 401 Unauthorized

**Solution**: Check that your `VITE_SUPABASE_ANON_KEY` is correct in `.env`

---

**Problem**: Network tab shows 404 Not Found

**Solution 1**: Verify the Edge Function is deployed:
```bash
npx supabase functions list
```

**Solution 2**: Check the URL format - should be `/functions/v1/parcels-tile`

---

**Problem**: Network tab shows 500 Internal Server Error

**Solution**: Check Edge Function logs:
```bash
npx supabase functions logs parcels-tile
```

Or in Supabase Dashboard: Functions > parcels-tile > Logs

---

**Problem**: Tiles are empty but function returns data

**Solution**: Check that parcels have geometries in SRID 4326:
```sql
SELECT COUNT(*), ST_SRID(geom) FROM parcels GROUP BY ST_SRID(geom);
```

### Content-Type Issues

**Problem**: Tiles show `application/octet-stream` instead of `application/vnd.mapbox-vector-tile`

**Solution**: You're using the RPC endpoint instead of the Edge Function. Update your `.env`:
```env
# Wrong (RPC endpoint):
VITE_PARCELS_TILES_URL=https://xxx.supabase.co/rest/v1/rpc/parcels_tile?z={z}&x={x}&y={y}

# Correct (Edge Function):
VITE_PARCELS_TILES_URL=https://xxx.supabase.co/functions/v1/parcels-tile?z={z}&x={x}&y={y}
```

---

**Problem**: No gzip compression

**Solution**: The Edge Function automatically compresses. Check response headers. If missing, update the Edge Function code to ensure `Content-Encoding: gzip` is set.

### Performance Issues

**Problem**: Tiles are slow to generate

**Solution 1**: Run the simplified geometry update:
```sql
SELECT update_simplified_geometries();
```

**Solution 2**: Check that spatial indexes exist:
```sql
-- Should show indexes on geom and geom_simplified
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'parcels';
```

**Solution 3**: Analyze table statistics:
```sql
ANALYZE parcels;
```

**Solution 4**: Check for slow queries:
```sql
SELECT query, calls, mean_time, max_time
FROM pg_stat_statements
WHERE query LIKE '%parcels_tile%'
ORDER BY mean_time DESC;
```

### Memory Issues

**Problem**: Edge Function times out or runs out of memory

**Solution 1**: Reduce tile complexity - increase simplification tolerance in the database function

**Solution 2**: Increase Edge Function timeout (in Supabase dashboard)

**Solution 3**: Use pagination or limit features per tile:
```sql
-- In the tile function, add LIMIT:
WHERE ST_Intersects(...) AND z >= 10
LIMIT 10000
```

## Performance Benchmarks

Expected performance for Davis County parcels (~50,000 features):

| Zoom Level | Features/Tile | Tile Size (gzipped) | Generation Time |
|------------|---------------|---------------------|-----------------|
| 10-12      | 100-500       | 5-20 KB            | 50-150ms        |
| 13-14      | 50-200        | 10-40 KB           | 30-100ms        |
| 15-16      | 20-100        | 15-60 KB           | 20-80ms         |
| 17-18      | 5-30          | 5-20 KB            | 10-40ms         |

## Comparison: Edge Function vs RPC vs Static Tiles

| Feature | Edge Function | RPC Endpoint | Static Tiles (CDN) |
|---------|--------------|--------------|-------------------|
| Content-Type | ✅ Correct | ❌ Wrong | ✅ Correct |
| Gzip | ✅ Yes | ❌ No | ✅ Yes |
| Cache headers | ✅ Yes | ❌ No | ✅ Yes |
| Setup complexity | Medium | Low | High |
| Data freshness | Always current | Always current | Stale |
| Best for | Production | Development | Large datasets |

**Recommendation**: Use Edge Function for production. It's the best balance of performance, correctness, and maintainability.

## Maintenance

### After Bulk Imports

Always run after importing new parcels:

```sql
SELECT update_simplified_geometries();
VACUUM ANALYZE parcels;
```

### Monitoring

Monitor Edge Function performance:

```bash
# View logs
npx supabase functions logs parcels-tile --follow

# Or in Supabase Dashboard:
# Functions > parcels-tile > Invocations
```

Monitor database performance:

```sql
-- Tile function performance
SELECT calls, mean_time, max_time
FROM pg_stat_statements
WHERE query LIKE '%parcels_tile%';
```

### Updating the Edge Function

After making changes to `supabase/functions/parcels-tile/index.ts`:

```bash
npx supabase functions deploy parcels-tile
```

## Advanced: CDN Caching

To add CDN caching (Cloudflare, etc):

1. Deploy Edge Function as above
2. Configure CDN to cache requests to `/functions/v1/parcels-tile`
3. Cache based on query parameters (z, x, y)
4. Set cache TTL to match `Cache-Control` header (1 hour)

Example Cloudflare Worker:

```javascript
// Cache tiles at edge for 1 hour
const cache = caches.default;
const cacheKey = new Request(url.toString(), request);
let response = await cache.match(cacheKey);

if (!response) {
  response = await fetch(request);
  if (response.ok) {
    await cache.put(cacheKey, response.clone());
  }
}
```

## Resources

- [PostGIS MVT documentation](https://postgis.net/docs/ST_AsMVT.html)
- [Mapbox Vector Tile Specification](https://github.com/mapbox/vector-tile-spec)
- [deck.gl MVTLayer docs](https://deck.gl/docs/api-reference/geo-layers/mvt-layer)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase PostGIS guide](https://supabase.com/docs/guides/database/extensions/postgis)
