-- Enable PostGIS extension for spatial data
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create parcels table
CREATE TABLE IF NOT EXISTS parcels (
  id BIGSERIAL PRIMARY KEY,

  -- Parcel identifiers
  apn TEXT UNIQUE NOT NULL,
  object_id INTEGER,

  -- Property information
  address TEXT,
  city TEXT,
  zip_code TEXT,
  county TEXT DEFAULT 'Davis',

  -- Owner information
  owner_name TEXT,
  owner_address TEXT,
  owner_city TEXT,
  owner_state TEXT,
  owner_zip TEXT,

  -- Property details
  size_acres DECIMAL(10, 4),
  property_value DECIMAL(12, 2),
  subdivision TEXT,
  year_built INTEGER,
  sqft INTEGER,

  -- URLs and metadata
  property_url TEXT,

  -- Spatial data (PostGIS geometry type)
  -- Using SRID 4326 (WGS84 - standard lat/lng)
  geom GEOMETRY(MultiPolygon, 4326),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create spatial index on geometry column (critical for performance)
CREATE INDEX IF NOT EXISTS parcels_geom_idx ON parcels USING GIST (geom);

-- Create indexes on commonly queried fields
CREATE INDEX IF NOT EXISTS parcels_apn_idx ON parcels (apn);
CREATE INDEX IF NOT EXISTS parcels_city_idx ON parcels (city);
CREATE INDEX IF NOT EXISTS parcels_owner_name_idx ON parcels (owner_name);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_parcels_updated_at
  BEFORE UPDATE ON parcels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comment to table
COMMENT ON TABLE parcels IS 'Davis County parcel data with owner information and spatial geometry';
