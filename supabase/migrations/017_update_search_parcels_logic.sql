-- Improve search_parcels to catch more true-vacant parcels and normalize filters
-- - Treat selected 'Vacant' as: prop_class='Vacant' OR has_building=false
-- - Use COALESCE(parcel_acres, size_acres) for acreage filters
-- - Normalize county/city comparisons

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
DECLARE
  norm_cities text[];
  norm_county text;
  classes text[];
  include_vacant boolean := false;
BEGIN
  -- Increase timeout just for this function execution
  PERFORM set_config('statement_timeout', '15000', true);

  -- Normalize cities and county
  IF cities IS NOT NULL THEN
    SELECT array_agg(upper(trim(c))) INTO norm_cities FROM unnest(cities) AS c WHERE trim(c) <> '';
  ELSE
    norm_cities := NULL;
  END IF;

  IF county_filter IS NOT NULL THEN
    norm_county := upper(trim(county_filter));
  ELSE
    norm_county := NULL;
  END IF;

  -- Normalize classes and detect if 'Vacant' is requested
  IF prop_classes IS NOT NULL THEN
    SELECT array_agg(trim(c)) INTO classes FROM unnest(prop_classes) AS c WHERE trim(c) <> '';
    include_vacant := 'Vacant' = ANY(classes);
  ELSE
    classes := NULL;
  END IF;

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
    ST_AsGeoJSON(ST_SimplifyPreserveTopology(p.geom, 0.00005), 6)::text AS geom
  FROM public.parcels p
  WHERE
    -- Acreage using COALESCE to include rows missing LIR parcel_acres
    (min_acres IS NULL OR COALESCE(p.parcel_acres, p.size_acres) >= min_acres)
    AND (max_acres IS NULL OR COALESCE(p.parcel_acres, p.size_acres) <= max_acres)
    -- Property class or inferred vacancy
    AND (
      classes IS NULL
      OR p.prop_class = ANY(classes)
      OR (
        include_vacant AND ( (p.bldg_sqft IS NULL OR p.bldg_sqft = 0) AND p.built_yr IS NULL )
      )
    )
    -- Market value filters
    AND (min_value IS NULL OR p.total_mkt_value >= min_value)
    AND (max_value IS NULL OR p.total_mkt_value <= max_value)
    -- Optional building status if provided
    AND (has_building IS NULL OR
         (has_building = true AND (p.bldg_sqft > 0 OR p.built_yr IS NOT NULL)) OR
         (has_building = false AND (p.bldg_sqft IS NULL OR p.bldg_sqft = 0) AND p.built_yr IS NULL))
    -- County filter (normalized)
    AND (norm_county IS NULL OR upper(trim(p.county)) = norm_county)
    -- City filter (normalized)
    AND (norm_cities IS NULL OR upper(trim(p.city)) = ANY(norm_cities))
  ORDER BY COALESCE(p.parcel_acres, p.size_acres) DESC, p.id
  LIMIT result_limit;
END;
$$;

COMMENT ON FUNCTION public.search_parcels IS 'Enhanced logic: Vacant includes no-building parcels even if prop_class not Vacant; normalized filters; acreage uses COALESCE.';

