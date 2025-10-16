-- Add missing GP categories to eliminate all "Other" zones
-- Creates new categories: Religious, Education, Health Care, Utilities, Cemeteries, and Residential (general)

CREATE OR REPLACE FUNCTION normalize_gp_category(zone_name text, zone_code text, city text, zone_type text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  search_text text;
BEGIN
  -- Combine all inputs for pattern matching (case-insensitive)
  search_text := lower(
    coalesce(zone_name, '') || ' ' ||
    coalesce(zone_code, '') || ' ' ||
    coalesce(zone_type, '')
  );

  -- Residential Low Density: R-1, A-40, A-20, A-5, Low Density, Single Family
  -- Fixed: Handle "Low Denisty" typo from Syracuse
  IF search_text ~ '(low.*den[sc]ity.*residential|residential.*low.*den[sc]ity|single.*family|^r-1|^a-40|^a-20|^a-5|^r/i-p|low.*den[sc]ity$)' THEN
    RETURN 'Residential Low Density';

  -- Residential Medium Density: R-2, R-3, Medium Density
  ELSIF search_text ~ '(medium.*den[sc]ity.*residential|residential.*medium.*den[sc]ity|^r-2|^r-3)' THEN
    RETURN 'Residential Medium Density';

  -- Residential High Density: R-4, R-5, R-6, R-C, High Density, Multifamily
  ELSIF search_text ~ '(high.*den[sc]ity.*residential|residential.*high.*den[sc]ity|^r-4|^r-5|^r-6|^r-c|multifamily|multi.*family)' THEN
    RETURN 'Residential High Density';

  -- Commercial: C-C, N-C, Commercial, Retail (NOT business - that goes to Industrial)
  ELSIF search_text ~ '(commercial|^c-c|^n-c|c-\d+|retail|main.*street|commercial.*core)' THEN
    RETURN 'Commercial';

  -- Mixed Use
  ELSIF search_text ~ '(mixed.*use|^mu-|mixed-use)' THEN
    RETURN 'Mixed Use';

  -- Industrial: Manufacturing, Business Park, Industrial
  ELSIF search_text ~ '(industrial|manufacturing|business|^i-\d+)' THEN
    RETURN 'Industrial';

  -- Parks & Recreation: P, P-O, Parks, Open Space, Agriculture/Wetlands
  -- Includes Layton "Open Space/Public Facilities"
  ELSIF search_text ~ '(^p$|^p-o|^parks$|^open space$|park|recreation|open.*space|public.*facilities|wetland|green.*space|agriculture)' THEN
    RETURN 'Parks & Recreation';

  -- Education (Schools)
  ELSIF search_text ~ '(education|school)' THEN
    RETURN 'Education';

  -- Religious
  ELSIF search_text ~ '(religious|church|temple|mosque|synagogue)' THEN
    RETURN 'Religious';

  -- Health Care
  ELSIF search_text ~ '(health|hospital|medical|clinic)' THEN
    RETURN 'Health Care';

  -- Utilities/Infrastructure
  ELSIF search_text ~ '(utilit|infrastructure|water|sewer|electric)' THEN
    RETURN 'Utilities';

  -- Cemeteries
  ELSIF search_text ~ '(cemeter|cemetery|burial)' THEN
    RETURN 'Cemeteries';

  -- Public/Institutional: Public buildings, Civic
  ELSIF search_text ~ '(public.*institutional|institutional|civic|government)' THEN
    RETURN 'Public/Institutional';

  -- General Residential (catch-all for "residential" with no density specified)
  -- This catches zone_type="residential" without other qualifiers
  ELSIF search_text ~ '(^residential$)' THEN
    RETURN 'Residential Low Density';

  -- Overlays and special districts - keep as Other
  ELSIF search_text ~ '(overlay|corridor|district\*)' THEN
    RETURN 'Other';

  -- Everything else - mostly the 218 Layton "other" zones which are likely overlay/admin boundaries
  ELSE
    RETURN 'Other';
  END IF;
END;
$$;

-- Re-normalize all zones
UPDATE public.general_plan
SET normalized_category = normalize_gp_category(zone_name, zone_code, city, zone_type);

-- Show the new distribution
SELECT
  normalized_category,
  COUNT(*) as count
FROM general_plan
GROUP BY normalized_category
ORDER BY count DESC;

COMMENT ON FUNCTION normalize_gp_category IS 'Converts city-specific zone names into standardized categories. Includes: Residential (Low/Med/High), Commercial, Mixed Use, Industrial, Parks, Education, Religious, Health Care, Utilities, Cemeteries, Public/Institutional, and Other.';
