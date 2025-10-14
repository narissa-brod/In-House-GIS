Utah Municipal Boundaries Ingest

Goal
- Populate `public.municipal_boundaries` from the Utah AGRC Feature Service so the parcel search can match cities by geometry when parcel `city` is missing.

Source
- ArcGIS Feature Service: https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahMunicipalBoundaries/FeatureServer/0

Options
- ogr2ogr (recommended if you have GDAL):
  - Assumes you have a direct connection string to your PostGIS (Supabase) DB.
  - Example:
    - ogr2ogr -f "PostgreSQL" PG:"host=… dbname=… user=… password=… sslmode=require" \
      "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahMunicipalBoundaries/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" \
      -nln municipal_boundaries -nlt MULTIPOLYGON -lco GEOMETRY_NAME=geom -lco FID=id -overwrite
    - After import, set names if the field names differ:
      - UPDATE public.municipal_boundaries SET name = COALESCE(name, COALESCE("NAME", "CITY", "MUNICIPALITY", "LABEL"));
      - UPDATE public.municipal_boundaries SET muni_type = COALESCE(muni_type, COALESCE("TYPE", "CLASS"));

- Curl + psql (works without GDAL):
  - Download GeoJSON:
    - curl -L -o municipal_boundaries.json "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahMunicipalBoundaries/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson"
  - Load via SQL (run in psql connected to your DB):
    - CREATE TEMP TABLE mb_raw (j jsonb);
    - \\copy mb_raw FROM PROGRAM 'cat municipal_boundaries.json' WITH (FORMAT text);
    - INSERT INTO public.municipal_boundaries (name, muni_type, geom)
      SELECT
        COALESCE(j->'properties'->>'NAME', j->'properties'->>'CITY', j->'properties'->>'MUNICIPALITY', j->'properties'->>'LABEL') AS name,
        COALESCE(j->'properties'->>'TYPE', j->'properties'->>'CLASS') AS muni_type,
        ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(j->>'geometry')), 4326) AS geom
      FROM (
        SELECT jsonb_array_elements((SELECT mb_raw.j->'features')) AS j FROM mb_raw LIMIT 1
      ) s
      WHERE j ? 'geometry';

Post steps
- Verify counts: SELECT COUNT(*) FROM public.municipal_boundaries;
- Spot check names and geometry validity: SELECT name, ST_IsValid(geom) FROM public.municipal_boundaries LIMIT 10;

Usage in search
- After the table is populated, the `search_parcels` function (migration 020) will satisfy city filters by either:
  - Attribute match on parcel `city` (normalized, prefix allowed), OR
  - Spatial intersect with `municipal_boundaries` where `name_norm` matches the requested city.

