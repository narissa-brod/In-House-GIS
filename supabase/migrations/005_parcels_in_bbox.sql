-- Create an RPC to fetch parcels intersecting a bounding box
-- Matches frontend call signature used in Map.vue
-- Returns key attributes and geometry as GeoJSON text for easy parsing

CREATE OR REPLACE FUNCTION public.parcels_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  county_filter text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  apn text,
  address text,
  city text,
  county text,
  zip_code text,
  owner_type text,
  size_acres numeric,
  property_url text,
  geom text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id,
    p.apn,
    p.address,
    p.city,
    p.county,
    p.zip_code,
    p.owner_type,
    p.size_acres,
    p.property_url,
    ST_AsGeoJSON(p.geom)::text AS geom
  FROM public.parcels p
  WHERE
    (county_filter IS NULL OR p.county = county_filter)
    AND ST_Intersects(
      p.geom,
      ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    )
  ORDER BY p.id;
$$;

