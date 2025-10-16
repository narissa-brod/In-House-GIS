-- Fix GP normalization to use zone_type field when zone_name/zone_code are NULL
-- Many GP zones only have zone_type populated

-- Drop the old function (3-parameter version)
DROP FUNCTION IF EXISTS normalize_gp_category(text, text, text);

-- Create new function with zone_type parameter
CREATE OR REPLACE FUNCTION normalize_gp_category(zone_name text, zone_code text, city text, zone_type text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  search_text text;
BEGIN
  -- Combine all inputs for pattern matching (case-insensitive)
  -- Include zone_type since some zones only have this field populated
  search_text := lower(
    coalesce(zone_name, '') || ' ' ||
    coalesce(zone_code, '') || ' ' ||
    coalesce(zone_type, '')
  );

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

  -- Parks & Recreation: P, P-O, Parks, Open Space, Agriculture/Wetlands
  ELSIF search_text ~ '(^p$|^p-o$|^parks$|^open space$|park|recreation|open.*space|wetland|green.*space|agriculture)' THEN
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

-- Update the trigger to pass zone_type
DROP TRIGGER IF EXISTS set_normalized_gp_category ON public.general_plan;

CREATE OR REPLACE FUNCTION trigger_set_normalized_gp_category()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.normalized_category := normalize_gp_category(NEW.zone_name, NEW.zone_code, NEW.city, NEW.zone_type);
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_normalized_gp_category
BEFORE INSERT OR UPDATE OF zone_name, zone_code, city, zone_type ON public.general_plan
FOR EACH ROW
EXECUTE FUNCTION trigger_set_normalized_gp_category();

-- Re-normalize all existing records with the updated function
UPDATE public.general_plan
SET normalized_category = normalize_gp_category(zone_name, zone_code, city, zone_type);

-- Show the new distribution
SELECT
  normalized_category,
  COUNT(*) as count
FROM general_plan
GROUP BY normalized_category
ORDER BY count DESC;

COMMENT ON FUNCTION normalize_gp_category IS 'Converts city-specific zone names into standardized categories. Now includes zone_type field for better coverage.';
