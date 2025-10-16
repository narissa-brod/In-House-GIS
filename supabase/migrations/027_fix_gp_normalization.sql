-- Fix general plan normalization to handle all zone types
-- Updates the normalize_gp_category function with better pattern matching

CREATE OR REPLACE FUNCTION normalize_gp_category(zone_name text, zone_code text, city text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  search_text text;
BEGIN
  -- Combine inputs for pattern matching (case-insensitive)
  search_text := lower(coalesce(zone_name, '') || ' ' || coalesce(zone_code, ''));

  -- Residential Low Density: R-1, A-40, A-20, A-5, Low Density, Single Family
  IF search_text ~ '(low.*den[sc]ity.*residential|residential.*low.*den[sc]ity|single.*family|r-1\b|a-40|a-20|a-5|r/i-p)' THEN
    RETURN 'Residential Low Density';

  -- Residential Medium Density: R-2, R-3, R-4, Medium Density
  ELSIF search_text ~ '(medium.*den[sc]ity.*residential|residential.*medium.*den[sc]ity|r-2\b|r-3\b|r-4\b)' THEN
    RETURN 'Residential Medium Density';

  -- Residential High Density: R-5, R-6, R-C, High Density
  ELSIF search_text ~ '(high.*den[sc]ity.*residential|residential.*high.*den[sc]ity|r-5\b|r-6\b|r-c\b)' THEN
    RETURN 'Residential High Density';

  -- Commercial: C-C, N-C, Commercial, overlay districts
  ELSIF search_text ~ '(commercial|c-c|n-c|c-\d+|retail|business|main.*street|commercial.*core)' THEN
    RETURN 'Commercial';

  -- Mixed Use
  ELSIF search_text ~ '(mixed.*use|mu-|mixed-use)' THEN
    RETURN 'Mixed Use';

  -- Industrial
  ELSIF search_text ~ '(industrial|manufacturing|i-\d+)' THEN
    RETURN 'Industrial';

  -- Parks & Recreation: P, P-O, Parks/Agriculture/Wetlands, Open Space
  ELSIF search_text ~ '(^p$|^p-o$|park|recreation|open.*space|wetland|green.*space|agriculture)' THEN
    RETURN 'Parks & Recreation';

  -- Public/Institutional: SCHOOLS, Public, Institutional, Civic
  ELSIF search_text ~ '(school|public.*institutional|institutional|civic|government)' THEN
    RETURN 'Public/Institutional';

  -- Overlays and special districts - categorize as Other
  ELSIF search_text ~ '(overlay|corridor|district\*)' THEN
    RETURN 'Other';

  -- Everything else
  ELSE
    RETURN 'Other';
  END IF;
END;
$$;

-- Re-normalize all existing records
UPDATE public.general_plan
SET normalized_category = normalize_gp_category(zone_name, zone_code, city);

-- Show the new distribution
DO $$
BEGIN
  RAISE NOTICE 'Updated normalization. New distribution:';
END $$;

SELECT
  normalized_category,
  COUNT(*) as count
FROM general_plan
GROUP BY normalized_category
ORDER BY normalized_category;
