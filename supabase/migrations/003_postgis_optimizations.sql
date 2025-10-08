-- Create spatial index on the geometry column for fast bounding-box queries
CREATE INDEX IF NOT EXISTS parcels_gix ON public.parcels USING gist (geom);

-- Create an index on the county column for faster filtering
CREATE INDEX IF NOT EXISTS parcels_county_idx ON public.parcels(county);

-- Update statistics for the query planner
ANALYZE public.parcels;

-- Create a function to get a single parcel's details by APN,
-- excluding the large geometry field for a faster response.
CREATE OR REPLACE FUNCTION parcel_by_apn(apn_in text)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT to_jsonb(p) - 'geom'
  FROM parcels p
  WHERE p.apn = apn_in
  LIMIT 1;
$$;