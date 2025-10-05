-- Create a function to truncate parcels table
-- This is used by the import script to clear all data before importing

CREATE OR REPLACE FUNCTION truncate_parcels()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  TRUNCATE TABLE parcels RESTART IDENTITY CASCADE;
END;
$$;

COMMENT ON FUNCTION truncate_parcels IS 'Truncates the parcels table and resets the ID sequence. Used for data imports.';
