-- Create function to generate Mapbox Vector Tiles (MVT) for parcels
-- This allows serving tiles directly from Supabase without needing separate tile infrastructure

CREATE OR REPLACE FUNCTION parcels_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
  result bytea;
  tile_bbox geometry;
BEGIN
  -- Calculate the bounding box for this tile using Web Mercator (SRID 3857)
  -- ST_TileEnvelope is a PostGIS 3.0+ function that calculates tile bounds
  tile_bbox := ST_TileEnvelope(z, x, y);

  -- Generate MVT tile
  -- ST_AsMVT creates a Mapbox Vector Tile from the geometries
  -- ST_AsMVTGeom transforms geometries to tile coordinates and clips to tile bounds
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
      -- Transform to Web Mercator and convert to MVT geometry
      -- Simplify geometry based on zoom level for performance
      ST_AsMVTGeom(
        ST_Transform(geom, 3857),
        tile_bbox,
        4096,
        -- Buffer in pixels to avoid clipping issues at tile edges
        256,
        -- Clip geometry to tile bounds
        true
      ) AS geom
    FROM parcels
    WHERE
      -- Only include parcels that intersect with the tile bounding box
      ST_Intersects(
        geom,
        ST_Transform(tile_bbox, 4326)
      )
      -- Optional: Only serve tiles at certain zoom levels to reduce load
      AND z >= 10
  ) AS tile
  WHERE geom IS NOT NULL;

  RETURN result;
END;
$$;

-- Add comment explaining the function
COMMENT ON FUNCTION parcels_tile IS 'Generates Mapbox Vector Tiles (MVT) for parcels at given z/x/y tile coordinates. Returns binary MVT data.';

-- Create index on geometry in Web Mercator if not exists for faster tile generation
-- This is in addition to the existing GIST index in WGS84
CREATE INDEX IF NOT EXISTS parcels_geom_3857_idx ON parcels USING GIST (ST_Transform(geom, 3857));
