-- Temporary fix: Manually update Layton "Open Space/Public Facilities" zones to Parks & Recreation
-- Long-term: Need to re-import Layton GP with proper property mapping (General_Plan -> zone_name)

-- Since all Layton zones have zone_type='other' and NULL names, we can't directly identify them
-- The proper fix requires re-importing the Layton GeoJSON with correct property mapping

-- For now, document what needs to be done:
-- 1. The import script should map GeoJSON property "General_Plan" to database field "zone_name"
-- 2. Then "Open Space/Public Facilities" will automatically match the Parks & Recreation pattern

-- Temporary workaround: If you know specific IDs of Open Space zones, update them:
-- UPDATE public.general_plan
-- SET zone_name = 'Open Space/Public Facilities',
--     zone_type = 'Open Space',
--     normalized_category = 'Parks & Recreation'
-- WHERE id IN (/* specific IDs here */);

-- Better approach: Re-run the import script for Layton GP with proper property mapping
-- The import script should do: zone_name = properties['General_Plan']

COMMENT ON TABLE public.general_plan IS 'General plan zones. Note: Layton zones need to be re-imported with General_Plan property mapped to zone_name field.';

-- For reference, here are the Layton General Plan zone types that should map to each category:
-- Parks & Recreation: "Open Space/Public Facilities"
-- Residential Low Density: "Low Density Residential", "Neighborhood Residential", "Neighborhood Ag Heritage"
-- Residential Medium: "Community Residential", "Transitional Residential"
-- Residential High: "Condo/Apartment", "Condo/Townhouse"
-- Commercial: "Commercial", "Town Center", "Urban District"
-- Mixed Use: "Mixed Use", "Mixed Use Corridors", "Business Park/Mixed Use"
-- Industrial: "Industrial Flex", "Manufacturing", "Business/Research Park", "Business Park Expansion Area", "Professional Business"
-- Education: "School"
-- Public/Institutional: "Insitutional Use", "APZ Insitutional Use"
-- Agriculture: "Agriculture", "APZ Agriculture"
-- Other: "Approved Development", "APZ Manufacturing"
