-- Usage:
--   1) Download GeoJSON next to this script as municipal_boundaries.json
--        curl -L -o municipal_boundaries.json "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahMunicipalBoundaries/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson"
--   2) Run in psql connected to your Supabase/PostGIS DB:
--        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ingest_municipal_boundaries_psql.sql

\echo Ingesting Utah Municipal Boundaries from municipal_boundaries.json

BEGIN;

-- Ensure table exists (migration 019 creates it); create minimal table if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'municipal_boundaries'
  ) THEN
    CREATE TABLE public.municipal_boundaries (
      id bigserial PRIMARY KEY,
      name text NOT NULL,
      name_norm text,
      muni_type text,
      source text DEFAULT 'Utah AGRC UtahMunicipalBoundaries',
      geom geometry(MultiPolygon, 4326) NOT NULL
    );
    CREATE INDEX municipal_boundaries_gix ON public.municipal_boundaries USING gist (geom);
    CREATE INDEX municipal_boundaries_name_norm_idx ON public.municipal_boundaries (name_norm);
  END IF;
END$$;

-- Stage file lines, then rebuild JSON and parse features
DROP TABLE IF EXISTS _mb_stage;
CREATE TEMP TABLE _mb_stage (
  line text
);
\copy _mb_stage FROM 'municipal_boundaries.json';

WITH j AS (
  SELECT (string_agg(line, E'\n' ORDER BY rn))::jsonb AS doc
  FROM (
    SELECT line, row_number() OVER () rn FROM _mb_stage
  ) s
), feats AS (
  SELECT jsonb_array_elements(doc->'features') AS feat FROM j
), parsed AS (
  SELECT
    COALESCE(feat->'properties'->>'NAME', feat->'properties'->>'CITY', feat->'properties'->>'MUNICIPALITY', feat->'properties'->>'LABEL') AS name,
    COALESCE(feat->'properties'->>'TYPE', feat->'properties'->>'CLASS') AS muni_type,
    ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON((feat->'geometry')::text)), 4326) AS geom
  FROM feats
)
-- Replace data to keep table in sync with source
TRUNCATE TABLE public.municipal_boundaries;
INSERT INTO public.municipal_boundaries (name, name_norm, muni_type, geom)
SELECT
  name,
  public.norm_place_name(name),
  muni_type,
  ST_Multi(ST_MakeValid(geom))
FROM parsed
WHERE name IS NOT NULL;

COMMIT;

\echo Done.

