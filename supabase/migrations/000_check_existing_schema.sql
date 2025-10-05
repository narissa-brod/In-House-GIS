-- Query to check your existing parcels table structure
-- Run this first in Supabase SQL Editor to see what you have

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM
  information_schema.columns
WHERE
  table_name = 'parcels'
ORDER BY
  ordinal_position;

-- Also check existing indexes
SELECT
  indexname,
  indexdef
FROM
  pg_indexes
WHERE
  tablename = 'parcels';
