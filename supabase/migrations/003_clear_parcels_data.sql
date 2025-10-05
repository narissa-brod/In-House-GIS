-- Clear all existing data from parcels table
-- Run this BEFORE importing Davis County data

-- This will delete all rows but keep the table structure
DELETE FROM parcels;

-- Reset the ID sequence to start from 1 again
ALTER SEQUENCE parcels_id_seq RESTART WITH 1;

-- Verify the table is empty
SELECT COUNT(*) as row_count FROM parcels;
-- Should return: row_count = 0
