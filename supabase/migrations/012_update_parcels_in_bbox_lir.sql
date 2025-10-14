-- Update parcels_in_bbox function to include new LIR fields
-- This allows the frontend to access property classification, building details, and market values

-- Drop ALL versions of the old function first (required when changing return type)
DROP FUNCTION IF EXISTS public.parcels_in_bbox(double precision, double precision, double precision, double precision, text);
DROP FUNCTION IF EXISTS public.parcels_in_bbox(double precision, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.parcels_in_bbox;

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
  -- New LIR fields
  prop_class text,
  bldg_sqft numeric,
  built_yr integer,
  parcel_acres numeric,
  total_mkt_value numeric,
  land_mkt_value numeric,
  house_cnt text,
  primary_res text,
  -- Geometry (always last)
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
    -- New LIR fields
    p.prop_class,
    p.bldg_sqft,
    p.built_yr,
    p.parcel_acres,
    p.total_mkt_value,
    p.land_mkt_value,
    p.house_cnt,
    p.primary_res,
    -- Geometry as GeoJSON text
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

COMMENT ON FUNCTION public.parcels_in_bbox IS 'Fetch parcels intersecting a bounding box with LIR fields (property class, building details, market values)';
