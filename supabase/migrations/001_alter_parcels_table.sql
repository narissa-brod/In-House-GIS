-- Enable PostGIS extension for spatial data
CREATE EXTENSION IF NOT EXISTS postgis;

-- ALTER existing parcels table to add missing columns
-- This won't affect existing data, just adds new columns

DO $$
BEGIN
  -- Add owner columns if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='owner_name') THEN
    ALTER TABLE parcels ADD COLUMN owner_name TEXT;
    RAISE NOTICE 'Added column: owner_name';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='owner_address') THEN
    ALTER TABLE parcels ADD COLUMN owner_address TEXT;
    RAISE NOTICE 'Added column: owner_address';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='owner_city') THEN
    ALTER TABLE parcels ADD COLUMN owner_city TEXT;
    RAISE NOTICE 'Added column: owner_city';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='owner_state') THEN
    ALTER TABLE parcels ADD COLUMN owner_state TEXT;
    RAISE NOTICE 'Added column: owner_state';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='owner_zip') THEN
    ALTER TABLE parcels ADD COLUMN owner_zip TEXT;
    RAISE NOTICE 'Added column: owner_zip';
  END IF;

  -- Add object_id if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='object_id') THEN
    ALTER TABLE parcels ADD COLUMN object_id INTEGER;
    RAISE NOTICE 'Added column: object_id';
  END IF;

  -- Add property_url if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='property_url') THEN
    ALTER TABLE parcels ADD COLUMN property_url TEXT;
    RAISE NOTICE 'Added column: property_url';
  END IF;

  -- Make sure geom column exists with correct type
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='geom') THEN
    ALTER TABLE parcels ADD COLUMN geom GEOMETRY(MultiPolygon, 4326);
    RAISE NOTICE 'Added column: geom';
  END IF;
END $$;

-- Create spatial index on geometry column if it doesn't exist (critical for performance)
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

-- Drop existing trigger if it exists, then recreate
DROP TRIGGER IF EXISTS update_parcels_updated_at ON parcels;

CREATE TRIGGER update_parcels_updated_at
  BEFORE UPDATE ON parcels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comment to table
COMMENT ON TABLE parcels IS 'Davis County parcel data with owner information and spatial geometry';
