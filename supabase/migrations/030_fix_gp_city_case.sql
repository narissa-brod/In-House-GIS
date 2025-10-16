-- Fix city field for general_plan to match parcel city names (uppercase)
-- Updates GP city to match how parcels store city names

-- First, populate city using case-insensitive spatial join
UPDATE public.general_plan gp
SET city = (
  SELECT p.city
  FROM parcels p
  WHERE ST_Intersects(gp.geom, p.geom)
    AND p.city IS NOT NULL
    AND p.city != ''
    AND p.county = 'Davis'
  GROUP BY p.city
  ORDER BY COUNT(*) DESC
  LIMIT 1
)
WHERE gp.city IS NULL OR gp.city = '';

-- Re-normalize after updating city
UPDATE public.general_plan
SET normalized_category = normalize_gp_category(zone_name, zone_code, city);

-- Show the distribution
SELECT
  city,
  normalized_category,
  COUNT(*) as count
FROM general_plan
WHERE city IS NOT NULL
GROUP BY city, normalized_category
ORDER BY city, normalized_category;
