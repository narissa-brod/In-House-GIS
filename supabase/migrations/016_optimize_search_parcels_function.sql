-- Optimize search_parcels: add simplified geometry and per-call timeout
-- Also keep same signature for frontend compatibility

CREATE OR REPLACE FUNCTION public.search_parcels(
  min_acres double precision DEFAULT NULL,
  max_acres double precision DEFAULT NULL,
  prop_classes text[] DEFAULT NULL,
  min_value double precision DEFAULT NULL,
  max_value double precision DEFAULT NULL,
  has_building boolean DEFAULT NULL,
  county_filter text DEFAULT NULL,
  cities text[] DEFAULT NULL,
  result_limit integer DEFAULT 1000
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
  -- Increase timeout just for this function execution
  PERFORM set_config('statement_timeout', '15000', true); -- 15 seconds

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
    -- Return simplified GeoJSON to reduce CPU + payload size
    ST_AsGeoJSON(ST_SimplifyPreserveTopology(p.geom, 0.00005), 6)::text AS geom
  FROM public.parcels p
  WHERE
    -- Acreage filters
    (min_acres IS NULL OR p.parcel_acres >= min_acres)
    AND (max_acres IS NULL OR p.parcel_acres <= max_acres)
    -- Property class filter (e.g., 'Vacant', 'Residential')
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
  ORDER BY p.parcel_acres DESC, p.id
  LIMIT result_limit;
END;
$$;

COMMENT ON FUNCTION public.search_parcels IS 'Optimized: Returns simplified GeoJSON, 15s local timeout; search by acreage, class, value, building, county, cities.';

