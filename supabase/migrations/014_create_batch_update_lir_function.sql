-- Create function to batch update LIR fields
-- This allows updating thousands of parcels in a single SQL call
-- Much faster than individual updates via REST API

CREATE OR REPLACE FUNCTION public.batch_update_lir_fields(
  lir_data jsonb
)
RETURNS TABLE (
  updated_count integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  update_count integer;
BEGIN
  -- Update parcels from JSON array
  -- Each element should have: apn, prop_class, bldg_sqft, built_yr, etc.
  UPDATE parcels
  SET
    prop_class = (rec->>'prop_class')::text,
    taxexempt_type = (rec->>'taxexempt_type')::text,
    primary_res = (rec->>'primary_res')::text,
    bldg_sqft = CASE
      WHEN rec->>'bldg_sqft' = 'null' OR rec->>'bldg_sqft' IS NULL THEN NULL
      ELSE (rec->>'bldg_sqft')::numeric
    END,
    bldg_sqft_info = (rec->>'bldg_sqft_info')::text,
    floors_cnt = CASE
      WHEN rec->>'floors_cnt' = 'null' OR rec->>'floors_cnt' IS NULL THEN NULL
      ELSE (rec->>'floors_cnt')::numeric
    END,
    floors_info = (rec->>'floors_info')::text,
    built_yr = CASE
      WHEN rec->>'built_yr' = 'null' OR rec->>'built_yr' IS NULL THEN NULL
      ELSE (rec->>'built_yr')::integer
    END,
    effbuilt_yr = CASE
      WHEN rec->>'effbuilt_yr' = 'null' OR rec->>'effbuilt_yr' IS NULL THEN NULL
      ELSE (rec->>'effbuilt_yr')::integer
    END,
    const_material = (rec->>'const_material')::text,
    total_mkt_value = CASE
      WHEN rec->>'total_mkt_value' = 'null' OR rec->>'total_mkt_value' IS NULL THEN NULL
      ELSE (rec->>'total_mkt_value')::numeric
    END,
    land_mkt_value = CASE
      WHEN rec->>'land_mkt_value' = 'null' OR rec->>'land_mkt_value' IS NULL THEN NULL
      ELSE (rec->>'land_mkt_value')::numeric
    END,
    parcel_acres = CASE
      WHEN rec->>'parcel_acres' = 'null' OR rec->>'parcel_acres' IS NULL THEN NULL
      ELSE (rec->>'parcel_acres')::numeric
    END,
    house_cnt = (rec->>'house_cnt')::text,
    subdiv_name = (rec->>'subdiv_name')::text,
    tax_dist = (rec->>'tax_dist')::text
  FROM jsonb_array_elements(lir_data) AS rec
  WHERE parcels.apn = (rec->>'apn')::text;

  GET DIAGNOSTICS update_count = ROW_COUNT;

  RETURN QUERY SELECT update_count;
END;
$$;

COMMENT ON FUNCTION public.batch_update_lir_fields IS 'Batch update LIR fields for multiple parcels in a single transaction. Accepts JSONB array of parcel records.';

-- Example usage:
-- SELECT * FROM batch_update_lir_fields('[
--   {"apn": "010420001", "prop_class": "Vacant", "bldg_sqft": null, "built_yr": null, "total_mkt_value": 1423920.67, "parcel_acres": 640.0},
--   {"apn": "010420002", "prop_class": "Residential", "bldg_sqft": 2400, "built_yr": 1985, "total_mkt_value": 450000, "parcel_acres": 0.25}
-- ]'::jsonb);
