-- Add year built filtering to search_parcels function

-- Drop the old version of the function first to avoid signature conflicts
DROP FUNCTION IF EXISTS public.search_parcels(
  double precision, double precision, text[], double precision, double precision,
  boolean, text, text[], integer
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
  classes_u text[];
  has_vacant boolean := false;
BEGIN
  -- Increase timeout to 30 seconds for complex searches (especially on cold start)
  PERFORM set_config('statement_timeout', '30000', true);

  -- Normalize filters
  IF cities IS NOT NULL THEN
    SELECT array_agg(public.norm_place_name(c)) INTO norm_cities FROM unnest(cities) AS c WHERE trim(c) <> '';
  ELSE
    norm_cities := NULL;
  END IF;

  IF county_filter IS NOT NULL THEN
    norm_county := regexp_replace(
      regexp_replace(upper(trim(county_filter)), '\\s+', ' ', 'g'),
      '\\s+COUNTY$',
      ''
    );
  ELSE
    norm_county := NULL;
  END IF;

  IF prop_classes IS NOT NULL THEN
    SELECT array_agg(trim(c)) INTO classes FROM unnest(prop_classes) AS c WHERE trim(c) <> '';
    SELECT array_agg(upper(c)) INTO classes_u FROM unnest(classes) AS c;
    has_vacant := 'VACANT' = ANY(classes_u);
  ELSE
    classes := NULL; classes_u := NULL; has_vacant := false;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT p.*,
           (
             COALESCE(p.bldg_sqft, 0) > 200 OR               -- any meaningful square footage
             (p.built_yr IS NOT NULL AND p.built_yr > 0) OR  -- known (positive) build year
             NULLIF(p.house_cnt, '')::int > 0                -- reported house count
           ) AS has_bldg,
           -- Acres fallback: parcel_acres -> size_acres -> geometry area (geography meters^2 / 4046.85642)
           COALESCE(
             p.parcel_acres,
             p.size_acres,
             CASE WHEN p.geom IS NOT NULL THEN (ST_Area(p.geom::geography) / 4046.85642)::numeric ELSE NULL END
           ) AS acres,
           public.norm_place_name(p.city) AS city_norm,
           upper(COALESCE(p.prop_class, '')) AS class_u,
           regexp_split_to_array(upper(COALESCE(p.prop_class, '')), '[^A-Z0-9]+') AS class_words
    FROM public.parcels p
  )
  SELECT
    b.id, b.apn, b.address, b.city, b.county, b.zip_code,
    b.prop_class, b.bldg_sqft, b.built_yr,
    b.acres AS parcel_acres,
    b.total_mkt_value, b.land_mkt_value, b.owner_type,
    ST_AsGeoJSON(ST_SimplifyPreserveTopology(b.geom, 0.00005), 6)::text AS geom
  FROM base b
  WHERE
    -- Acreage using computed acres
    (min_acres IS NULL OR b.acres >= min_acres)
    AND (max_acres IS NULL OR b.acres <= max_acres)

    -- Property class and vacant logic (token-aware matching for non-vacant classes)
    AND (
      classes_u IS NULL
      OR (
           EXISTS (
             SELECT 1 FROM unnest(classes_u) c
             WHERE c <> 'VACANT' AND (
               -- Simple prefix match
               b.class_u LIKE c || '%'
               OR (
                 -- Token AND match: all tokens from c must appear in b.class_words
                 SELECT COALESCE(bool_and(tok = ANY(b.class_words)), false)
                 FROM unnest(regexp_split_to_array(c, '[^A-Z0-9]+')) tok
                 WHERE tok <> ''
               )
             )
           )
           OR (
             has_vacant AND (
               b.class_u LIKE '%VACANT%'
               OR b.has_bldg = false
             )
           )
         )
    )

    -- Market value filters
    AND (min_value IS NULL OR b.total_mkt_value >= min_value)
    AND (max_value IS NULL OR b.total_mkt_value <= max_value)

    -- Year built filters
    AND (
      -- No year filter applied at all
      (min_year IS NULL AND max_year IS NULL)
      OR
      -- Year filter is applied: include parcels that match year range, plus optionally include nulls
      (
        (min_year IS NOT NULL OR max_year IS NOT NULL) AND
        (
          -- Parcels within the year range
          (
            b.built_yr IS NOT NULL AND
            (min_year IS NULL OR b.built_yr >= min_year) AND
            (max_year IS NULL OR b.built_yr <= max_year)
          )
          OR
          -- Include parcels with null year if checkbox is checked
          (include_null_year = true AND b.built_yr IS NULL)
        )
      )
    )

    -- Optional building status override (no-op since client no longer sends)
    AND (
      has_building IS NULL OR
      (has_building = true AND b.has_bldg = true) OR
      (has_building = false AND b.has_bldg = false)
    )

    -- County filter (normalized)
    AND (
      norm_county IS NULL OR
      regexp_replace(regexp_replace(upper(trim(b.county)), '\\s+', ' ', 'g'), '\\s+COUNTY$', '') = norm_county
    )

    -- City filter: attribute or spatial boundary match (if municipal_boundaries populated)
    AND (
      norm_cities IS NULL OR
      (b.city_norm IS NOT NULL AND EXISTS (
        SELECT 1 FROM unnest(norm_cities) c WHERE b.city_norm LIKE c || '%'
      )) OR
      EXISTS (
        SELECT 1
        FROM public.municipal_boundaries mb
        WHERE mb.name_norm = ANY(norm_cities)
          AND ST_Intersects(b.geom, mb.geom)
      )
    )

  ORDER BY b.acres DESC, b.id
  LIMIT result_limit;
END;
$$;

COMMENT ON FUNCTION public.search_parcels IS 'Token-aware class match + year built filter + geometry acres fallback + spatial city fallback. Supports filtering by built_yr range with optional null inclusion.';
