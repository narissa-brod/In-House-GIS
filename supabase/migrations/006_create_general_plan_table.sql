-- Create general_plan table for land use designations
-- Supports polygon/multipolygon geometries with zone classifications

CREATE TABLE IF NOT EXISTS public.general_plan (
  id bigserial PRIMARY KEY,

  -- Zone/designation information
  zone_name text,           -- e.g., "Residential Low Density", "Commercial"
  zone_code text,            -- e.g., "R-1", "C-2"
  zone_type text,            -- Broad category: "residential", "commercial", "industrial", etc.

  -- Descriptive fields (from KMZ)
  name text,                 -- Feature name from KMZ
  description text,          -- Description from KMZ

  -- Metadata
  county text,               -- Which county
  city text,                 -- Which city/municipality
  year_adopted integer,      -- Year the general plan was adopted
  source text,               -- Source of data (e.g., "PDF converted to KMZ")

  -- Geometry (PostGIS) - accepts both Polygon and MultiPolygon
  geom geometry(Geometry, 4326),

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create spatial index for fast bounding box queries
CREATE INDEX IF NOT EXISTS general_plan_gix ON public.general_plan USING gist (geom);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS general_plan_county_idx ON public.general_plan(county);
CREATE INDEX IF NOT EXISTS general_plan_zone_type_idx ON public.general_plan(zone_type);

-- Update statistics
ANALYZE public.general_plan;

-- Create RPC function for bbox queries (same pattern as parcels)
CREATE OR REPLACE FUNCTION general_plan_in_bounds(bbox_wkt TEXT)
RETURNS SETOF general_plan
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM general_plan
  WHERE ST_Intersects(
    geom,
    ST_GeomFromText(bbox_wkt, 4326)
  );
END;
$$;

COMMENT ON TABLE public.general_plan IS 'General plan / land use designations';
COMMENT ON FUNCTION general_plan_in_bounds IS 'Returns general plan zones that intersect with the given bounding box (WKT format)';
