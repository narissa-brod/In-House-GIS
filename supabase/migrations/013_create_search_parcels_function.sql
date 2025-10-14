-- Create function to search parcels by multiple criteria
-- Used for custom layer creation (e.g., "2+ acres, vacant, residential zoning")

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
LANGUAGE sql STABLE
AS $$
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
$$;

COMMENT ON FUNCTION public.search_parcels IS 'Search parcels by acreage, property class, market value, building status, county, and cities. Returns up to result_limit parcels.';

-- Example usage:
-- Search for vacant parcels 2+ acres:
-- SELECT * FROM search_parcels(min_acres := 2.0, prop_classes := ARRAY['Vacant']);

-- Search for residential parcels under $500k with no buildings:
-- SELECT * FROM search_parcels(prop_classes := ARRAY['Residential'], max_value := 500000, has_building := false);
