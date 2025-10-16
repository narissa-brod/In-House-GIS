-- Add normalized_category column to general_plan table
-- This allows searching across different cities with standardized category names

ALTER TABLE public.general_plan
ADD COLUMN IF NOT EXISTS normalized_category text;

CREATE INDEX IF NOT EXISTS general_plan_normalized_category_idx
ON public.general_plan(normalized_category);

-- Function to normalize zone names into standard categories
CREATE OR REPLACE FUNCTION normalize_gp_category(zone_name text, zone_code text, city text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  normalized text;
  search_text text;
BEGIN
  -- Combine inputs for pattern matching (case-insensitive)
  search_text := lower(coalesce(zone_name, '') || ' ' || coalesce(zone_code, '') || ' ' || coalesce(city, ''));

  -- Residential Low Density: R-1, A-40, A-20, A-5, Low Density
  IF search_text ~ '(low.*density.*residential|residential.*low.*density|^r-1|^a-40|^a-20|^a-5|ld res|rld)' THEN
    RETURN 'Residential Low Density';

  -- Residential Medium Density: R-2, Medium Density Residential
  ELSIF search_text ~ '(medium.*density.*residential|residential.*medium.*density|^r-2|md res|rmd)' THEN
    RETURN 'Residential Medium Density';

  -- Residential High Density: High Density Residential
  ELSIF search_text ~ '(high.*density.*residential|residential.*high.*density|hd res|rhd)' THEN
    RETURN 'Residential High Density';

  -- Commercial: C-C, N-C, Commercial
  ELSIF search_text ~ '(commercial|^c-c|^n-c|^c-\d+|retail|business)' THEN
    RETURN 'Commercial';

  -- Mixed Use
  ELSIF search_text ~ '(mixed.*use|mu-|mixed-use)' THEN
    RETURN 'Mixed Use';

  -- Industrial
  ELSIF search_text ~ '(industrial|manufacturing|^i-\d+)' THEN
    RETURN 'Industrial';

  -- Parks & Recreation: P, Parks/Agriculture/Wetlands
  ELSIF search_text ~ '(^p$|park|recreation|open.*space|wetland|green.*space)' THEN
    RETURN 'Parks & Recreation';

  -- Agriculture
  ELSIF search_text ~ '(agricultural|^ag-|farm|agriculture)' THEN
    RETURN 'Agriculture';

  -- Public/Institutional: SCHOOLS, Public, Institutional
  ELSIF search_text ~ '(school|public|institutional|civic|government)' THEN
    RETURN 'Public/Institutional';

  -- Everything else
  ELSE
    RETURN 'Other';
  END IF;
END;
$$;

-- Update existing rows with normalized categories
UPDATE public.general_plan
SET normalized_category = normalize_gp_category(zone_name, zone_code, city);

-- Create trigger to auto-populate normalized_category on insert/update
CREATE OR REPLACE FUNCTION trigger_set_normalized_gp_category()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.normalized_category := normalize_gp_category(NEW.zone_name, NEW.zone_code, NEW.city);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_normalized_gp_category ON public.general_plan;

CREATE TRIGGER set_normalized_gp_category
BEFORE INSERT OR UPDATE OF zone_name, zone_code, city ON public.general_plan
FOR EACH ROW
EXECUTE FUNCTION trigger_set_normalized_gp_category();

COMMENT ON COLUMN public.general_plan.normalized_category IS 'Standardized category across all cities (e.g., "Residential Low Density", "Commercial")';
COMMENT ON FUNCTION normalize_gp_category IS 'Converts city-specific zone names into standardized categories for filtering';
