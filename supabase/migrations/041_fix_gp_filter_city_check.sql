-- Fix GP filtering to respect city filter
-- The bug: GP filter was checking ALL cities for matching zones, not just the selected city
-- This caused search results to INCREASE when adding GP filters (finding parcels from other cities)

DROP FUNCTION IF EXISTS public.search_parcels(
  double precision, double precision, text[], double precision, double precision,
  boolean, text, text[], integer, integer, boolean, text[], integer
);

CREATE OR REPLACE FUNCTION public.search_parcels(
  min_acres double precision DEFAULT NULL,
  max_acres double precision DEFAULT NULL,
  prop_classes text[] DEFAULT NULL,
  min_value double precision DEFAULT NULL,
  max_value double precision DEFAULT NULL,
  has_building boolean DEFAULT NULL,
  county_filter text DEFAULT NULL,
  cities text[] DEFAULT NULL,
  min_year integer DEFAULT NULL,
  max_year integer DEFAULT NULL,
  include_null_year boolean DEFAULT false,
  gp_zones text[] DEFAULT NULL,
  result_limit integer DEFAULT 5000
)
RETURNS TABLE (
  id bigint,
  apn text,
  address text,
  city text,
  county text,
  zip_code text,
  prop_class text,
  bldg_sqft numeric,
  built_yr integer,
  parcel_acres numeric,
  total_mkt_value numeric,
  land_mkt_value numeric,
  owner_type text,
  geom text
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  -- Allow up to 30 seconds for complex spatial searches
  PERFORM set_config('statement_timeout', '30000', true);

  RETURN QUERY
  SELECT
    p.id,
    p.apn,
    p.address,
    p.city,
    p.county,
    p.zip_code,
    p.prop_class,
    p.bldg_sqft,
    p.built_yr,
    p.parcel_acres,
    p.total_mkt_value,
    p.land_mkt_value,
    p.owner_type,
    ST_AsGeoJSON(p.geom)::text AS geom
  FROM public.parcels p
  WHERE
    -- Acreage filters
    (min_acres IS NULL OR p.parcel_acres >= min_acres)
    AND (max_acres IS NULL OR p.parcel_acres <= max_acres)
    -- Property class filter
    AND (prop_classes IS NULL OR p.prop_class = ANY(prop_classes))
    -- Market value filters
    AND (min_value IS NULL OR p.total_mkt_value >= min_value)
    AND (max_value IS NULL OR p.total_mkt_value <= max_value)
    -- Building existence filter
    AND (has_building IS NULL OR
         (has_building = true AND (p.bldg_sqft > 0 OR p.built_yr IS NOT NULL)) OR
         (has_building = false AND (p.bldg_sqft IS NULL OR p.bldg_sqft = 0) AND p.built_yr IS NULL))
    -- County filter
    AND (county_filter IS NULL OR p.county = county_filter)
    -- City filter
    AND (cities IS NULL OR p.city = ANY(cities))
    -- Year built filters
    AND (
      (min_year IS NULL AND max_year IS NULL) OR
      (min_year IS NOT NULL AND max_year IS NOT NULL AND p.built_yr BETWEEN min_year AND max_year) OR
      (min_year IS NOT NULL AND max_year IS NULL AND p.built_yr >= min_year) OR
      (min_year IS NULL AND max_year IS NOT NULL AND p.built_yr <= max_year) OR
      (include_null_year = true AND p.built_yr IS NULL)
    )
    -- General Plan filter: centroid proximity with small tolerance (~5m)
    -- When cities filter is applied, ensure GP zones are from those cities
    -- This prevents finding parcels from other cities that happen to have the same GP category
    AND (
      gp_zones IS NULL OR
      EXISTS (
        SELECT 1
        FROM public.general_plan gp
        WHERE gp.normalized_category = ANY(gp_zones)
          -- If cities filter is applied, match GP zones by spatial intersection with municipal boundaries
          AND (
            cities IS NULL OR
            EXISTS (
              SELECT 1
              FROM public.municipal_boundaries mb
              WHERE mb.name = ANY(cities)
                AND ST_Intersects(mb.geom, gp.geom)
            )
          )
          AND gp.geom && ST_Expand(p.geom, 0.0001)
          AND ST_DWithin(
            gp.geom,
            ST_Centroid(p.geom),
            0.00005 -- ≈5.5 meters at mid-latitudes
          )
      )
    )
  ORDER BY p.parcel_acres DESC
  LIMIT result_limit;
END;
$$;

COMMENT ON FUNCTION public.search_parcels IS 'Search parcels with optional GP zone filtering. Uses centroid proximity and ensures GP zones match the parcel city to prevent cross-city matches.';
