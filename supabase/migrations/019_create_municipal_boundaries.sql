-- Municipal boundaries table for spatial fallback city matching
-- Also adds a name normalization helper to mirror search logic

CREATE OR REPLACE FUNCTION public.norm_place_name(txt text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT regexp_replace(
           regexp_replace(upper(trim(txt)), '\\s+', ' ', 'g'),
           '\\s+(CITY|TOWN)$',
           ''
         )
$$;

CREATE TABLE IF NOT EXISTS public.municipal_boundaries (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  name_norm text GENERATED ALWAYS AS (public.norm_place_name(name)) STORED,
  muni_type text,
  source text DEFAULT 'Utah AGRC UtahMunicipalBoundaries',
  geom geometry(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS municipal_boundaries_gix ON public.municipal_boundaries USING gist (geom);
CREATE INDEX IF NOT EXISTS municipal_boundaries_name_norm_idx ON public.municipal_boundaries (name_norm);

COMMENT ON TABLE public.municipal_boundaries IS 'Utah municipal boundaries for deriving parcel city by geometry.';
COMMENT ON COLUMN public.municipal_boundaries.name_norm IS 'Uppercased, space-collapsed, suffix-trimmed name for matching (no CITY/TOWN suffix).';

