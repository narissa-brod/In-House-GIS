-- Use spatial city filtering via municipal boundaries
-- This fixes the issue where parcels don't have accurate city attributes
-- Now when you filter by city, it uses spatial intersection with municipal boundary polygons

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
    -- City filter: Use SPATIAL intersection with municipal boundaries
    -- This is more accurate than the city attribute field which may be NULL or outdated
    -- Uses name_norm for case-insensitive matching (e.g., 'LAYTON' matches 'Layton')
    AND (
      cities IS NULL OR
      EXISTS (
        SELECT 1
        FROM public.municipal_boundaries mb
        WHERE mb.name_norm = ANY(
          SELECT public.norm_place_name(unnest(cities))
        )
        AND ST_Intersects(mb.geom, ST_Centroid(p.geom))
      )
    )
    -- Year built filters
    AND (
      (min_year IS NULL AND max_year IS NULL) OR
      (min_year IS NOT NULL AND max_year IS NOT NULL AND p.built_yr BETWEEN min_year AND max_year) OR
      (min_year IS NOT NULL AND max_year IS NULL AND p.built_yr >= min_year) OR
      (min_year IS NULL AND max_year IS NOT NULL AND p.built_yr <= max_year) OR
      (include_null_year = true AND p.built_yr IS NULL)
    )
    -- General Plan filter: centroid proximity with small tolerance (~5m)
    -- When cities filter is applied, GP zones are already restricted by the city filter above
    AND (
      gp_zones IS NULL OR
      EXISTS (
        SELECT 1
        FROM public.general_plan gp
        WHERE gp.normalized_category = ANY(gp_zones)
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

COMMENT ON FUNCTION public.search_parcels IS 'Search parcels with spatial city filtering via municipal boundaries. More accurate than city attribute field. GP zones are filtered by city through spatial intersection.';

-- Create spatial index on municipal_boundaries if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_municipal_boundaries_geom ON public.municipal_boundaries USING GIST(geom);
