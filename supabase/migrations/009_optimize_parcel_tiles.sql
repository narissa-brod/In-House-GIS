-- Additional optimizations for vector tile performance

-- Create a simplified geometry column for lower zoom levels
-- This dramatically improves performance by pre-computing simplified geometries
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS geom_simplified GEOMETRY(MultiPolygon, 4326);

-- Create index on simplified geometry
CREATE INDEX IF NOT EXISTS parcels_geom_simplified_idx ON parcels USING GIST (geom_simplified);

-- Function to update simplified geometry (run this after importing parcels)
CREATE OR REPLACE FUNCTION update_simplified_geometries()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Simplify geometries for faster rendering at lower zooms
  -- Tolerance of 0.0001 degrees (~11 meters) is good for zoom levels 10-14
  UPDATE parcels
  SET geom_simplified = ST_Multi(ST_SimplifyPreserveTopology(geom, 0.0001))
  WHERE geom_simplified IS NULL OR ST_NPoints(geom_simplified) > ST_NPoints(ST_SimplifyPreserveTopology(geom, 0.0001));

  -- Vacuum to reclaim space
  VACUUM ANALYZE parcels;
END;
$$;

-- Enhanced tile function with zoom-based simplification
CREATE OR REPLACE FUNCTION parcels_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
  result bytea;
  tile_bbox geometry;
  simplification_tolerance float;
BEGIN
  -- Calculate the bounding box for this tile
  tile_bbox := ST_TileEnvelope(z, x, y);

  -- Adjust simplification based on zoom level
  -- Higher zoom = less simplification (more detail)
  -- Lower zoom = more simplification (better performance)
  CASE
    WHEN z >= 16 THEN simplification_tolerance := 0;      -- No simplification at high zoom
    WHEN z >= 14 THEN simplification_tolerance := 1;      -- Minimal simplification
    WHEN z >= 12 THEN simplification_tolerance := 2;      -- Light simplification
    ELSE simplification_tolerance := 4;                    -- Aggressive simplification
  END CASE;

  -- Generate MVT tile
  SELECT INTO result ST_AsMVT(tile, 'parcels', 4096, 'geom')
  FROM (
    SELECT
      id,
      apn,
      address,
      city,
      county,
      owner_name,
      size_acres,
      property_url,
      -- Use simplified geometry for lower zooms, full geometry for high zooms
      ST_AsMVTGeom(
        ST_Transform(
          CASE
            WHEN z < 14 AND geom_simplified IS NOT NULL THEN geom_simplified
            ELSE geom
          END,
          3857
        ),
        tile_bbox,
        4096,
        256,
        true
      ) AS geom
    FROM parcels
    WHERE
      -- Spatial filter: only parcels intersecting this tile
      ST_Intersects(
        ST_Transform(geom, 3857),
        tile_bbox
      )
      -- Only serve tiles at zoom 10 and above
      AND z >= 10
  ) AS tile
  WHERE geom IS NOT NULL;

  -- Return empty tile if no features
  IF result IS NULL THEN
    result := ST_AsMVT(NULL, 'parcels', 4096, 'geom');
  END IF;

  RETURN result;
END;
$$;

-- Create a function to get tile metadata/stats
CREATE OR REPLACE FUNCTION parcels_tile_stats(z integer, x integer, y integer)
RETURNS TABLE(feature_count bigint, tile_size_bytes integer)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  tile_bbox geometry;
BEGIN
  tile_bbox := ST_TileEnvelope(z, x, y);

  RETURN QUERY
  SELECT
    COUNT(*) as feature_count,
    LENGTH(parcels_tile(z, x, y)) as tile_size_bytes
  FROM parcels
  WHERE ST_Intersects(ST_Transform(geom, 3857), tile_bbox);
END;
$$;

-- Add comments
COMMENT ON FUNCTION update_simplified_geometries IS 'Updates simplified geometry column for all parcels. Run after bulk imports.';
COMMENT ON FUNCTION parcels_tile_stats IS 'Returns statistics about a specific tile (feature count and size in bytes)';
COMMENT ON COLUMN parcels.geom_simplified IS 'Simplified geometry for faster rendering at lower zoom levels (z < 14)';
