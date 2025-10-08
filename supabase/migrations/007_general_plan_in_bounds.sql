-- RPC to fetch General Plan polygons intersecting a bounding box
-- Ensure we replace any prior version with a different return type/signature
DROP FUNCTION IF EXISTS public.general_plan_in_bounds(text);
CREATE OR REPLACE FUNCTION public.general_plan_in_bounds(
  bbox_wkt text
)
RETURNS TABLE (
  id bigint,
  zone_name text,
  zone_code text,
  zone_type text,
  name text,
  description text,
  county text,
  city text,
  year_adopted integer,
  source text,
  geom text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    gp.id,
    gp.zone_name,
    gp.zone_code,
    gp.zone_type,
    gp.name,
    gp.description,
    gp.county,
    gp.city,
    gp.year_adopted,
    gp.source,
    ST_AsGeoJSON(gp.geom)::text AS geom
  FROM public.general_plan gp
  WHERE ST_Intersects(gp.geom, ST_GeomFromText(bbox_wkt, 4326))
  ORDER BY gp.id;
$$;

-- Optional: grant execute to common Supabase roles
GRANT EXECUTE ON FUNCTION public.general_plan_in_bounds(text) TO anon, authenticated;
