-- Create counties table for Utah county boundaries
CREATE TABLE IF NOT EXISTS counties (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  fips_code TEXT,
  area_sq_mi NUMERIC,
  geom GEOMETRY(MULTIPOLYGON, 4326),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create spatial index on geometry
CREATE INDEX IF NOT EXISTS counties_geom_idx ON counties USING GIST (geom);

-- Create index on name for faster lookups
CREATE INDEX IF NOT EXISTS counties_name_idx ON counties (name);

-- Add comment
COMMENT ON TABLE counties IS 'Utah county boundaries from UGRC';
