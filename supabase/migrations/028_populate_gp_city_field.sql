-- Populate city field for general_plan records by spatial join with parcels
-- This assigns each GP zone to the most common city of parcels it contains

UPDATE public.general_plan gp
SET city = (
  SELECT p.city
  FROM parcels p
  WHERE ST_Intersects(gp.geom, p.geom)
    AND p.city IS NOT NULL
    AND p.city != ''
  GROUP BY p.city
  ORDER BY COUNT(*) DESC
  LIMIT 1
)
WHERE gp.city IS NULL;

-- Re-normalize after updating city (in case city affects categorization)
UPDATE public.general_plan
SET normalized_category = normalize_gp_category(zone_name, zone_code, city);

-- Show distribution by city
SELECT
  city,
  normalized_category,
  COUNT(*) as count
FROM general_plan
WHERE city IS NOT NULL
GROUP BY city, normalized_category
ORDER BY city, normalized_category;
