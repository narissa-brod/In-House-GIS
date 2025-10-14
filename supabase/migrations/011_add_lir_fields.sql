-- Add Land Information Records (LIR) fields to parcels table
-- These fields come from the Davis County LIR API which includes
-- property classification, building details, and market values

DO $$
BEGIN
  -- Property Classification
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='prop_class') THEN
    ALTER TABLE parcels ADD COLUMN prop_class TEXT;
    RAISE NOTICE 'Added column: prop_class';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='taxexempt_type') THEN
    ALTER TABLE parcels ADD COLUMN taxexempt_type TEXT;
    RAISE NOTICE 'Added column: taxexempt_type';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='primary_res') THEN
    ALTER TABLE parcels ADD COLUMN primary_res TEXT;
    RAISE NOTICE 'Added column: primary_res';
  END IF;

  -- Building/Improvement Details
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='bldg_sqft') THEN
    ALTER TABLE parcels ADD COLUMN bldg_sqft DECIMAL(10, 2);
    RAISE NOTICE 'Added column: bldg_sqft';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='bldg_sqft_info') THEN
    ALTER TABLE parcels ADD COLUMN bldg_sqft_info TEXT;
    RAISE NOTICE 'Added column: bldg_sqft_info';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='floors_cnt') THEN
    ALTER TABLE parcels ADD COLUMN floors_cnt DECIMAL(3, 1);
    RAISE NOTICE 'Added column: floors_cnt';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='floors_info') THEN
    ALTER TABLE parcels ADD COLUMN floors_info TEXT;
    RAISE NOTICE 'Added column: floors_info';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='built_yr') THEN
    ALTER TABLE parcels ADD COLUMN built_yr INTEGER;
    RAISE NOTICE 'Added column: built_yr';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='effbuilt_yr') THEN
    ALTER TABLE parcels ADD COLUMN effbuilt_yr INTEGER;
    RAISE NOTICE 'Added column: effbuilt_yr';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='const_material') THEN
    ALTER TABLE parcels ADD COLUMN const_material TEXT;
    RAISE NOTICE 'Added column: const_material';
  END IF;

  -- Market Values
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='total_mkt_value') THEN
    ALTER TABLE parcels ADD COLUMN total_mkt_value DECIMAL(12, 2);
    RAISE NOTICE 'Added column: total_mkt_value';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='land_mkt_value') THEN
    ALTER TABLE parcels ADD COLUMN land_mkt_value DECIMAL(12, 2);
    RAISE NOTICE 'Added column: land_mkt_value';
  END IF;

  -- Additional Details
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='parcel_acres') THEN
    ALTER TABLE parcels ADD COLUMN parcel_acres DECIMAL(10, 4);
    RAISE NOTICE 'Added column: parcel_acres';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='house_cnt') THEN
    ALTER TABLE parcels ADD COLUMN house_cnt TEXT;
    RAISE NOTICE 'Added column: house_cnt';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='subdiv_name') THEN
    ALTER TABLE parcels ADD COLUMN subdiv_name TEXT;
    RAISE NOTICE 'Added column: subdiv_name';
  END IF;

  -- Tax district
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parcels' AND column_name='tax_dist') THEN
    ALTER TABLE parcels ADD COLUMN tax_dist TEXT;
    RAISE NOTICE 'Added column: tax_dist';
  END IF;
END $$;

-- Create indexes on commonly filtered fields
CREATE INDEX IF NOT EXISTS parcels_prop_class_idx ON parcels (prop_class);
CREATE INDEX IF NOT EXISTS parcels_built_yr_idx ON parcels (built_yr);
CREATE INDEX IF NOT EXISTS parcels_bldg_sqft_idx ON parcels (bldg_sqft);
CREATE INDEX IF NOT EXISTS parcels_parcel_acres_idx ON parcels (parcel_acres);
CREATE INDEX IF NOT EXISTS parcels_total_mkt_value_idx ON parcels (total_mkt_value);

-- Add comments explaining the key fields
COMMENT ON COLUMN parcels.prop_class IS 'Property classification: Vacant, Residential, Commercial, Industrial, Mixed, Agricultural, Open Space, Other';
COMMENT ON COLUMN parcels.bldg_sqft IS 'Square footage of primary building(s)';
COMMENT ON COLUMN parcels.built_yr IS 'Year of initial construction';
COMMENT ON COLUMN parcels.total_mkt_value IS 'Total market value of parcel (land + improvements)';
COMMENT ON COLUMN parcels.land_mkt_value IS 'Market value of land only';
COMMENT ON COLUMN parcels.parcel_acres IS 'Parcel size in acres (from LIR, may differ from size_acres)';
