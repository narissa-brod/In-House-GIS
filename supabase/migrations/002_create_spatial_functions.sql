-- Create a PostgreSQL function for efficient spatial bounding box queries
-- This function will be called from the client via .rpc()

CREATE OR REPLACE FUNCTION parcels_in_bounds(bbox_wkt TEXT)
RETURNS SETOF parcels
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM parcels
  WHERE ST_Intersects(
    geom,
    ST_GeomFromText(bbox_wkt, 4326)
  );
END;
$$;

-- Add comment
COMMENT ON FUNCTION parcels_in_bounds IS 'Returns parcels that intersect with the given bounding box (WKT format)';
