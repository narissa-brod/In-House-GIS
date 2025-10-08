-- ============================================================================
-- Phase 1: PostGIS Database Optimizations
-- Run this in your Supabase SQL Editor
-- ============================================================================

-- 1. Add Spatial Index (if not exists)
-- This makes ST_Intersects queries MUCH faster (milliseconds vs seconds)
CREATE INDEX IF NOT EXISTS parcels_geom_gist_idx
ON parcels USING GIST (geom);

-- 2. Add County Index for multi-county filtering
CREATE INDEX IF NOT EXISTS parcels_county_idx
ON parcels (county);

-- 3. Add APN Index for quick lookups
CREATE INDEX IF NOT EXISTS parcels_apn_idx
ON parcels (apn);

-- 4. Add composite index for common queries (county + spatial)
CREATE INDEX IF NOT EXISTS parcels_county_geom_idx
ON parcels (county, geom)
WHERE geom IS NOT NULL;

-- 5. Update table statistics (helps query planner choose best indexes)
ANALYZE parcels;

-- 6. Cluster table by spatial index (groups nearby parcels physically on disk)
-- WARNING: This locks the table briefly. Run during low-traffic time.
-- CLUSTER parcels USING parcels_geom_gist_idx;
-- ANALYZE parcels;
-- (Commented out - run manually when ready)

-- ============================================================================
-- 7. Create optimized RPC function to fetch parcel details by APN
-- ============================================================================

DROP FUNCTION IF EXISTS parcel_by_apn(TEXT);

CREATE OR REPLACE FUNCTION parcel_by_apn(apn_in TEXT)
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
  SELECT to_jsonb(p.*) - 'geom' || jsonb_build_object(
    'geom', ST_AsGeoJSON(p.geom)::jsonb,
    'bbox', ARRAY[
      ST_XMin(p.geom),
      ST_YMin(p.geom),
      ST_XMax(p.geom),
      ST_YMax(p.geom)
    ]
  )
  FROM parcels p
  WHERE p.apn = apn_in
  LIMIT 1;
$$;

-- ============================================================================
-- 8. Create optimized multi-county bbox function
-- ============================================================================

DROP FUNCTION IF EXISTS parcels_in_bbox(FLOAT, FLOAT, FLOAT, FLOAT, TEXT);

CREATE OR REPLACE FUNCTION parcels_in_bbox(
  min_lng FLOAT,
  min_lat FLOAT,
  max_lng FLOAT,
  max_lat FLOAT,
  county_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  apn TEXT,
  address TEXT,
  city TEXT,
  county TEXT,
  zip_code TEXT,
  owner_type TEXT,
  owner_name TEXT,
  owner_address TEXT,
  size_acres NUMERIC,
  property_url TEXT,
  property_value NUMERIC,
  subdivision TEXT,
  year_built INTEGER,
  sqft NUMERIC,
  geom TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.apn,
    p.address,
    p.city,
    p.county,
    p.zip_code,
    p.owner_type,
    p.owner_name,
    p.owner_address,
    p.size_acres,
    p.property_url,
    p.property_value,
    p.subdivision,
    p.year_built,
    p.sqft,
    ST_AsGeoJSON(p.geom)::TEXT as geom
  FROM parcels p
  WHERE ST_Intersects(
    p.geom,
    ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
  )
  AND (county_filter IS NULL OR p.county = county_filter)
  ORDER BY ST_Distance(
    p.geom,
    ST_Centroid(ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326))
  )
  LIMIT 10000;
END;
$$;

-- ============================================================================
-- 9. Create function to get parcel count by county (useful for stats)
-- ============================================================================

CREATE OR REPLACE FUNCTION parcel_stats()
RETURNS TABLE (
  county TEXT,
  count BIGINT,
  total_acres NUMERIC,
  min_acres NUMERIC,
  max_acres NUMERIC,
  avg_acres NUMERIC
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    county,
    COUNT(*) as count,
    SUM(size_acres) as total_acres,
    MIN(size_acres) as min_acres,
    MAX(size_acres) as max_acres,
    AVG(size_acres) as avg_acres
  FROM parcels
  WHERE size_acres IS NOT NULL
  GROUP BY county
  ORDER BY county;
$$;

-- ============================================================================
-- 10. Create function to search parcels by address (for autocomplete)
-- ============================================================================

CREATE OR REPLACE FUNCTION search_parcels(search_term TEXT, limit_count INT DEFAULT 10)
RETURNS TABLE (
  id BIGINT,
  apn TEXT,
  address TEXT,
  city TEXT,
  county TEXT,
  size_acres NUMERIC
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    id,
    apn,
    address,
    city,
    county,
    size_acres
  FROM parcels
  WHERE
    address ILIKE '%' || search_term || '%'
    OR apn ILIKE '%' || search_term || '%'
  ORDER BY
    CASE
      WHEN address ILIKE search_term || '%' THEN 1
      WHEN address ILIKE '%' || search_term || '%' THEN 2
      ELSE 3
    END,
    address
  LIMIT limit_count;
$$;

-- ============================================================================
-- Performance verification queries (run these to test improvements)
-- ============================================================================

-- Test 1: Check index usage
-- EXPLAIN ANALYZE
-- SELECT * FROM parcels_in_bbox(-112.0, 40.5, -111.5, 41.0, 'Davis');

-- Test 2: Check parcel lookup speed
-- EXPLAIN ANALYZE
-- SELECT parcel_by_apn('12-345-6789');

-- Test 3: View table stats
-- SELECT * FROM parcel_stats();

-- Test 4: Test search
-- SELECT * FROM search_parcels('main st');

-- ============================================================================
-- Maintenance queries (run periodically for best performance)
-- ============================================================================

-- Refresh statistics (run weekly or after bulk imports):
-- ANALYZE parcels;

-- Rebuild indexes (only if needed after major changes):
-- REINDEX TABLE parcels;

-- Check index sizes:
-- SELECT
--   schemaname,
--   tablename,
--   indexname,
--   pg_size_pretty(pg_relation_size(indexrelid::regclass)) as size
-- FROM pg_indexes
-- JOIN pg_class ON pg_class.relname = indexname
-- WHERE tablename = 'parcels';

-- ============================================================================
-- DONE! Your database is now optimized.
--
-- Next steps:
-- 1. Run this entire file in Supabase SQL Editor
-- 2. Test performance improvements in your app
-- 3. Monitor query times in browser console
-- ============================================================================
