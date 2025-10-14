-- Create batch insert function for municipal_boundaries
-- This allows inserting multiple municipal boundaries in a single transaction

CREATE OR REPLACE FUNCTION public.insert_municipal_boundaries(
  boundaries_data jsonb
)
RETURNS TABLE (
  inserted_count integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  insert_count integer;
BEGIN
  -- Insert municipal boundaries from JSON array
  -- Each element should have: name, muni_type, source, geom (GeoJSON string)
  INSERT INTO public.municipal_boundaries (name, muni_type, source, geom)
  SELECT
    (rec->>'name')::text,
    (rec->>'muni_type')::text,
    COALESCE((rec->>'source')::text, 'Utah AGRC UtahMunicipalBoundaries'),
    ST_GeomFromGeoJSON(rec->>'geom')::geometry(MultiPolygon, 4326)
  FROM jsonb_array_elements(boundaries_data) AS rec;

  GET DIAGNOSTICS insert_count = ROW_COUNT;

  RETURN QUERY SELECT insert_count;
END;
$$;

COMMENT ON FUNCTION public.insert_municipal_boundaries IS 'Batch insert municipal boundaries from JSONB array. Each record must have name, geom (GeoJSON MultiPolygon string), and optional muni_type and source.';

-- Example usage:
-- SELECT * FROM insert_municipal_boundaries('[
--   {
--     "name": "Bountiful",
--     "muni_type": "City",
--     "source": "Utah AGRC UtahMunicipalBoundaries",
--     "geom": "{\"type\":\"MultiPolygon\",\"coordinates\":[[[[...]]]]}"
--   }
-- ]'::jsonb);
