-- Fix West Point zone normalization and change filter to use ST_Intersects instead of centroid

-- Step 1: Update normalization function to handle West Point zones better
CREATE OR REPLACE FUNCTION normalize_gp_category(zone_name text, zone_code text, city text, zone_type text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  search_text text;
BEGIN
  -- Combine all inputs for pattern matching (case-insensitive)
  search_text := lower(
    coalesce(zone_name, '') || ' ' ||
    coalesce(zone_code, '') || ' ' ||
    coalesce(zone_type, '')
  );

  -- Residential Low Density: R-1, A-40, A-20, A-5, Low Density, Single Family
  IF search_text ~ '(low.*den[sc]ity.*residential|residential.*low.*den[sc]ity|single.*family|\br-1\b|\ba-40\b|\ba-20\b|\ba-5\b|\br/i-p\b)' THEN
    RETURN 'Residential Low Density';

  -- Residential Medium Density: R-2, R-3, Medium Density
  ELSIF search_text ~ '(medium.*den[sc]ity.*residential|residential.*medium.*den[sc]ity|\br-2\b|\br-3\b)' THEN
    RETURN 'Residential Medium Density';

  -- Residential High Density: R-4, R-5, R-6, R-C, High Density
  ELSIF search_text ~ '(high.*den[sc]ity.*residential|residential.*high.*den[sc]ity|\br-4\b|\br-5\b|\br-6\b|\br-c\b)' THEN
    RETURN 'Residential High Density';

  -- Commercial: C-C, N-C, Commercial, overlay districts
  ELSIF search_text ~ '(commercial|\bc-c\b|\bn-c\b|c-\d+|retail|business|main.*street|commercial.*core)' THEN
    RETURN 'Commercial';

  -- Mixed Use
  ELSIF search_text ~ '(mixed.*use|\bmu-\b|mixed-use)' THEN
    RETURN 'Mixed Use';

  -- Industrial
  ELSIF search_text ~ '(industrial|manufacturing|i-\d+)' THEN
    RETURN 'Industrial';

  -- Parks & Recreation: P, P-O, Parks, Open Space, Agriculture/Wetlands
  -- Added \bp\b to match standalone "P"
  ELSIF search_text ~ '(\bp\b|\bp-o\b|\bparks\b|\bopen space\b|park|recreation|open.*space|wetland|green.*space|agriculture)' THEN
    RETURN 'Parks & Recreation';

  -- Public/Institutional: SCHOOLS, Public, Institutional, Civic
  ELSIF search_text ~ '(school|public.*institutional|institutional|civic|government)' THEN
    RETURN 'Public/Institutional';

  -- Overlays and special districts - categorize as Other
  ELSIF search_text ~ '(overlay|corridor|district\*)' THEN
    RETURN 'Other';

  -- Everything else
  ELSE
    RETURN 'Other';
  END IF;
END;
$$;

-- Step 2: Re-normalize all zones with the updated function
UPDATE public.general_plan
SET normalized_category = normalize_gp_category(zone_name, zone_code, city, zone_type);

-- Step 3: Update search_parcels to use ST_Intersects instead of ST_Contains with centroid
-- This catches parcels that overlap with GP zones, not just those whose centroid is inside
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
    -- General Plan filter: Check if parcel geometry intersects with ANY GP zone in selected categories
    -- ST_Intersects catches all parcels that overlap with GP zones (not just centroid)
    AND (
      gp_zones IS NULL OR
      EXISTS (
        SELECT 1
        FROM public.general_plan gp
        WHERE gp.normalized_category = ANY(gp_zones)
          AND ST_Intersects(gp.geom, p.geom)
      )
    )
  ORDER BY p.parcel_acres DESC
  LIMIT result_limit;
END;
$$;

COMMENT ON FUNCTION public.search_parcels IS 'Search parcels with optional GP zone filtering. Uses ST_Intersects to find all parcels that overlap with GP zones (not just centroid). Fast and catches all overlapping parcels.';

-- Show the updated distribution
SELECT
  normalized_category,
  COUNT(*) as count
FROM general_plan
GROUP BY normalized_category
ORDER BY count DESC;
