"""
ULTRA FAST UPDATE: Uses PostgreSQL batch update function
Updates 1000 parcels at a time in a single SQL call
Expected time: ~2-3 minutes for all 127k parcels
"""

import requests
import json
import os
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm
import time

# Load environment variables
load_dotenv('../.env')

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = (
    os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY") or
    os.getenv("SUPABASE_SERVICE_KEY") or
    os.getenv("VITE_SUPABASE_ANON_KEY")
)

if not SUPABASE_KEY:
    raise ValueError("Missing Supabase key! Set VITE_SUPABASE_SERVICE_ROLE_KEY in .env")

# Initialize Supabase client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Utah LIR API endpoint
DAVIS_PARCELS_LIR_URL = "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Davis_LIR/FeatureServer/0"

def get_lir_parcel_count():
    """Get total count of parcels in the LIR API"""
    url = f"{DAVIS_PARCELS_LIR_URL}/query"
    params = {
        'where': '1=1',
        'returnCountOnly': 'true',
        'f': 'json'
    }
    response = requests.get(url, params=params)
    data = response.json()
    return data.get('count', 0)

def fetch_lir_batch(offset=0, batch_size=1000):
    """Fetch a batch of LIR records from Utah API"""
    url = f"{DAVIS_PARCELS_LIR_URL}/query"

    params = {
        'where': '1=1',
        'outFields': '*',
        'returnGeometry': 'false',
        'f': 'json',
        'resultOffset': offset,
        'resultRecordCount': batch_size
    }

    try:
        response = requests.get(url, params=params, timeout=60)
        response.raise_for_status()
        data = response.json()
        return data.get('features', [])
    except Exception as e:
        print(f"\nError fetching LIR batch at offset {offset}: {e}")
        return []

def safe_value(value):
    """Convert value to JSON-safe format (None becomes null)"""
    if value is None or value == '':
        return None
    return value

def extract_lir_fields(feature):
    """Extract LIR fields as JSON-ready dict"""
    attrs = feature.get('attributes', {})

    apn = attrs.get('PARCEL_ID') or attrs.get('PARCELID') or attrs.get('APN')
    if not apn:
        return None

    return {
        'apn': str(apn) if apn else None,
        'prop_class': safe_value(attrs.get('PROP_CLASS')),
        'taxexempt_type': safe_value(attrs.get('TAXEXEMPT_TYPE')),
        'primary_res': safe_value(attrs.get('PRIMARY_RES')),
        'bldg_sqft': safe_value(attrs.get('BLDG_SQFT')),
        'bldg_sqft_info': safe_value(attrs.get('BLDG_SQFT_INFO')),
        'floors_cnt': safe_value(attrs.get('FLOORS_CNT')),
        'floors_info': safe_value(attrs.get('FLOORS_INFO')),
        'built_yr': safe_value(attrs.get('BUILT_YR')),
        'effbuilt_yr': safe_value(attrs.get('EFFBUILT_YR')),
        'const_material': safe_value(attrs.get('CONST_MATERIAL')),
        'total_mkt_value': safe_value(attrs.get('TOTAL_MKT_VALUE')),
        'land_mkt_value': safe_value(attrs.get('LAND_MKT_VALUE')),
        'parcel_acres': safe_value(attrs.get('PARCEL_ACRES')),
        'house_cnt': safe_value(attrs.get('HOUSE_CNT')),
        'subdiv_name': safe_value(attrs.get('SUBDIV_NAME')),
        'tax_dist': safe_value(attrs.get('TAX_DIST')),
    }

def batch_update_via_function(lir_records):
    """
    Update parcels using the PostgreSQL batch update function
    This is 100x faster than individual REST API calls
    """
    if not lir_records:
        return 0

    try:
        # Call the PostgreSQL function with JSON array
        # Pass list directly - Supabase client will convert to JSONB
        result = supabase.rpc(
            'batch_update_lir_fields',
            {'lir_data': lir_records}
        ).execute()

        if result.data and len(result.data) > 0:
            return result.data[0].get('updated_count', 0)
        return 0
    except Exception as e:
        print(f"\nBatch update error: {e}")
        return 0

def update_parcels_ultra_fast(limit=None, dry_run=False):
    """Ultra-fast update using PostgreSQL batch function"""
    print("=" * 70)
    print("ULTRA FAST UPDATE: LIR Data via PostgreSQL Function")
    print("=" * 70)
    print("This will merge vacancy, building, and market value data")
    print("WITHOUT overwriting owner information from Davis County API")
    print("Using batch SQL updates (1000 parcels per call)")
    print("=" * 70)

    if dry_run:
        print("\n[DRY RUN] - No database changes will be made\n")

    # Get total LIR records
    total_lir = get_lir_parcel_count()
    print(f"\nLIR records available: {total_lir:,}")

    if limit:
        print(f"Processing first {limit:,} records only")
        total_lir = min(total_lir, limit)

    # Fetch and update in batches
    batch_size = 1000
    offset = 0
    total_updated = 0
    total_processed = 0

    print("\nStarting ultra-fast LIR data merge...\n")

    with tqdm(total=total_lir, desc="Updating parcels", unit="parcels") as pbar:
        while offset < total_lir:
            # Fetch LIR batch from API
            features = fetch_lir_batch(offset, batch_size)

            if not features:
                print(f"\nNo more features at offset {offset}")
                break

            # Extract LIR fields
            lir_records = []
            for feature in features:
                try:
                    record = extract_lir_fields(feature)
                    if record and record.get('apn'):
                        lir_records.append(record)
                except Exception as e:
                    pass  # Skip bad records

            total_processed += len(lir_records)

            # Update database
            if not dry_run and lir_records:
                updated = batch_update_via_function(lir_records)
                total_updated += updated
            elif dry_run and lir_records:
                total_updated += len(lir_records)
                if offset == 0:
                    print("\n[SAMPLE] First LIR record that would be merged:")
                    sample = lir_records[0]
                    print(f"   APN: {sample.get('apn')}")
                    print(f"   Property Class: {sample.get('prop_class')}")
                    print(f"   Building Sqft: {sample.get('bldg_sqft')}")
                    print(f"   Built Year: {sample.get('built_yr')}")
                    if sample.get('total_mkt_value'):
                        print(f"   Total Market Value: ${float(sample.get('total_mkt_value')):,.2f}")
                    print(f"   Parcel Acres: {sample.get('parcel_acres')}\n")

            pbar.update(len(features))
            offset += batch_size

            # Very short delay since we're using batch function
            time.sleep(0.1)

    print("\n" + "=" * 70)
    if dry_run:
        print("DRY RUN COMPLETE")
        print(f"  Would process: {total_processed:,} LIR records")
        print(f"  Would update: {total_updated:,} parcels")
    else:
        print("UPDATE COMPLETE")
        print(f"  LIR records processed: {total_processed:,}")
        print(f"  Parcels updated: {total_updated:,}")

    print("=" * 70)

    if not dry_run:
        print("\n[SUCCESS] Your parcels now have:")
        print("   - Owner information (from Davis County GIS Portal)")
        print("   - Property classification (Vacant, Residential, etc.)")
        print("   - Building details (sqft, year built)")
        print("   - Market values (land + total)")
        print("\nReady to build the search UI!")

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Ultra-fast LIR update via PostgreSQL function')
    parser.add_argument('--limit', type=int, help='Limit number of records to process')
    parser.add_argument('--dry-run', action='store_true', help='Preview without updating')
    parser.add_argument('--run', action='store_true', help='Actually perform the update')

    args = parser.parse_args()

    if not args.dry_run and not args.run:
        print("\n[ERROR] You must specify either --dry-run or --run")
        print("\nExamples:")
        print("  python update_parcels_with_lir_ultra_fast.py --dry-run")
        print("  python update_parcels_with_lir_ultra_fast.py --run")
        print("  python update_parcels_with_lir_ultra_fast.py --run --limit 5000\n")
        exit(1)

    update_parcels_ultra_fast(limit=args.limit, dry_run=args.dry_run)
