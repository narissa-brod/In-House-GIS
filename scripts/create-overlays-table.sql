-- Create table for Layton City overlay layers
-- Run this in your Supabase SQL Editor

-- Drop existing table if you need to recreate
-- DROP TABLE IF EXISTS layton_overlays CASCADE;

CREATE TABLE IF NOT EXISTS layton_overlays (
  id BIGSERIAL PRIMARY KEY,

  -- Layer metadata
  layer_name TEXT NOT NULL,        -- e.g., 'debris_hazards', 'faults'
  layer_title TEXT NOT NULL,       -- e.g., 'Geology - Debris Hazards'
  layer_description TEXT,
  layer_color TEXT,                -- Hex color for rendering (e.g., '#ffa500')

  -- Feature properties from ArcGIS
  properties JSONB,                -- Original ArcGIS attributes

  -- Geometry (PostGIS)
  geom GEOMETRY(Geometry, 4326),   -- WGS84 projection

  -- Metadata
  source TEXT DEFAULT 'Layton City ArcGIS',
  source_url TEXT,
  feature_index INTEGER,           -- Order within the layer

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create spatial index for fast geometry queries
CREATE INDEX IF NOT EXISTS layton_overlays_geom_idx
  ON layton_overlays USING GIST (geom);

-- Create index on layer_name for filtering
CREATE INDEX IF NOT EXISTS layton_overlays_layer_name_idx
  ON layton_overlays (layer_name);

-- Enable Row Level Security (optional, adjust based on your needs)
ALTER TABLE layton_overlays ENABLE ROW LEVEL SECURITY;

-- Allow public read access (adjust based on your security requirements)
-- Drop policy if it exists, then create it
DROP POLICY IF EXISTS "Allow public read access to overlays" ON layton_overlays;
CREATE POLICY "Allow public read access to overlays"
  ON layton_overlays
  FOR SELECT
  TO public
  USING (true);

-- Create a function to query overlays within a bounding box
CREATE OR REPLACE FUNCTION layton_overlays_in_bounds(
  bbox_wkt TEXT,
  layer_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  layer_name TEXT,
  layer_title TEXT,
  layer_color TEXT,
  properties JSONB,
  geom GEOMETRY
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    lo.id,
    lo.layer_name,
    lo.layer_title,
    lo.layer_color,
    lo.properties,
    lo.geom
  FROM layton_overlays lo
  WHERE ST_Intersects(
    lo.geom,
    ST_GeomFromText(bbox_wkt, 4326)
  )
  AND (layer_filter IS NULL OR lo.layer_name = layer_filter)
  ORDER BY lo.layer_name, lo.feature_index;
END;
$$;

-- Create a function to get all features for a specific layer
CREATE OR REPLACE FUNCTION get_layer_geojson(layer_filter TEXT)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'name', layer_filter,
    'features', json_agg(
      json_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(geom)::json,
        'properties', properties
      )
    )
  )
  INTO result
  FROM layton_overlays
  WHERE layer_name = layer_filter
  ORDER BY feature_index;

  RETURN result;
END;
$$;

COMMENT ON TABLE layton_overlays IS 'Layton City overlay layers (geology, development agreements, etc.)';
COMMENT ON COLUMN layton_overlays.layer_name IS 'Unique identifier for the layer type';
COMMENT ON COLUMN layton_overlays.geom IS 'PostGIS geometry in WGS84 (SRID 4326)';
COMMENT ON FUNCTION layton_overlays_in_bounds IS 'Query overlay features within a bounding box, optionally filtered by layer';
COMMENT ON FUNCTION get_layer_geojson IS 'Get all features for a layer as GeoJSON';
