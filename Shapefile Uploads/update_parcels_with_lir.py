"""
Update existing Davis County parcels with LIR (Land Information Records) data
Merges building details, property classification, and market values
WITHOUT overwriting owner information from Davis County GIS Portal API
"""

import requests
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
        'returnGeometry': 'false',  # Don't need geometry for updates
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
        print(f"Error fetching LIR batch at offset {offset}: {e}")
        return []

def safe_float(value):
    """Safely convert value to float, handling None and empty strings"""
    if value is None or value == '':
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None

def safe_int(value):
    """Safely convert value to int, handling None and empty strings"""
    if value is None or value == '':
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

def safe_str(value):
    """Safely convert value to string, handling None"""
    if value is None or value == '':
        return None
    return str(value)

def extract_lir_fields(feature):
    """
    Extract LIR-specific fields from ArcGIS feature
    Returns dict with APN and LIR fields only
    """
    attrs = feature.get('attributes', {})

    # Extract APN - try multiple field names
    apn = (
        attrs.get('PARCEL_ID') or
        attrs.get('PARCELID') or
        attrs.get('APN')
    )

    if not apn:
        return None

    return {
        'apn': safe_str(apn),

        # Property classification
        'prop_class': safe_str(attrs.get('PROP_CLASS')),
        'taxexempt_type': safe_str(attrs.get('TAXEXEMPT_TYPE')),
        'primary_res': safe_str(attrs.get('PRIMARY_RES')),

        # Building details
        'bldg_sqft': safe_float(attrs.get('BLDG_SQFT')),
        'bldg_sqft_info': safe_str(attrs.get('BLDG_SQFT_INFO')),
        'floors_cnt': safe_float(attrs.get('FLOORS_CNT')),
        'floors_info': safe_str(attrs.get('FLOORS_INFO')),
        'built_yr': safe_int(attrs.get('BUILT_YR')),
        'effbuilt_yr': safe_int(attrs.get('EFFBUILT_YR')),
        'const_material': safe_str(attrs.get('CONST_MATERIAL')),

        # Market values
        'total_mkt_value': safe_float(attrs.get('TOTAL_MKT_VALUE')),
        'land_mkt_value': safe_float(attrs.get('LAND_MKT_VALUE')),

        # Additional details
        'parcel_acres': safe_float(attrs.get('PARCEL_ACRES')),
        'house_cnt': safe_str(attrs.get('HOUSE_CNT')),
        'subdiv_name': safe_str(attrs.get('SUBDIV_NAME')),
        'tax_dist': safe_str(attrs.get('TAX_DIST')),
    }

def update_parcel_batch(lir_records):
    """
    Update parcels in Supabase with LIR data
    Uses upsert with apn as conflict key
    """
    if not lir_records:
        return 0

    success_count = 0
    failed_count = 0

    for record in lir_records:
        try:
            # Update only LIR fields - don't touch owner info
            apn = record.pop('apn')

            # Use update() with match on apn
            result = supabase.table('parcels').update(record).eq('apn', apn).execute()

            # Check if any rows were actually updated
            if result.data and len(result.data) > 0:
                success_count += 1
            else:
                failed_count += 1

        except Exception as e:
            failed_count += 1
            # Uncomment for debugging:
            # print(f"\nError updating parcel {apn}: {e}")

    return success_count, failed_count

def update_parcels_with_lir(limit=None, dry_run=False):
    """
    Update existing parcels with LIR data

    Args:
        limit: Maximum number of parcels to process (None for all)
        dry_run: If True, fetch data but don't update database
    """
    print("=" * 70)
    print("UPDATE Existing Parcels with LIR Data")
    print("=" * 70)
    print("This will merge vacancy, building, and market value data")
    print("WITHOUT overwriting owner information from Davis County API")
    print("=" * 70)

    if dry_run:
        print("\n[DRY RUN] - No database changes will be made\n")

    # Get total LIR records available
    total_lir = get_lir_parcel_count()
    print(f"\nLIR records available: {total_lir:,}")

    if limit:
        print(f"Processing first {limit:,} records only")
        total_lir = min(total_lir, limit)

    # Fetch and update in batches
    batch_size = 1000
    offset = 0
    total_updated = 0
    total_failed = 0
    total_processed = 0

    print("\nStarting LIR data merge...\n")

    with tqdm(total=total_lir, desc="Updating parcels") as pbar:
        while offset < total_lir:
            # Fetch LIR batch
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
                    print(f"\nError extracting LIR data: {e}")

            total_processed += len(lir_records)

            # Update database (unless dry run)
            if not dry_run and lir_records:
                updated, failed = update_parcel_batch(lir_records)
                total_updated += updated
                total_failed += failed
            elif dry_run and lir_records:
                # In dry run, just count what we would update
                total_updated += len(lir_records)
                # Show sample record
                if offset == 0 and lir_records:
                    print("\n[SAMPLE] LIR record that would be merged:")
                    sample = lir_records[0]
                    print(f"   APN: {sample.get('apn')}")
                    print(f"   Property Class: {sample.get('prop_class')}")
                    print(f"   Building Sqft: {sample.get('bldg_sqft')}")
                    print(f"   Built Year: {sample.get('built_yr')}")
                    print(f"   Total Market Value: ${sample.get('total_mkt_value'):,.2f}" if sample.get('total_mkt_value') else "   Total Market Value: None")
                    print(f"   Parcel Acres: {sample.get('parcel_acres')}\n")

            pbar.update(len(features))
            offset += batch_size

            # Rate limiting
            time.sleep(0.3)

    print("\n" + "=" * 70)
    if dry_run:
        print("DRY RUN COMPLETE")
        print(f"  Would process: {total_processed:,} LIR records")
        print(f"  Would update: {total_updated:,} parcels")
    else:
        print("UPDATE COMPLETE")
        print(f"  LIR records processed: {total_processed:,}")
        print(f"  Parcels updated: {total_updated:,}")
        print(f"  Failed updates: {total_failed:,}")

        if total_failed > 0:
            print(f"\n[WARNING] {total_failed:,} parcels not found in database")
            print("    This is normal - LIR may have parcels not in Davis County GIS Portal")

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

    parser = argparse.ArgumentParser(description='Update parcels with LIR vacancy/building data')
    parser.add_argument('--limit', type=int, help='Limit number of LIR records to process (for testing)')
    parser.add_argument('--dry-run', action='store_true', help='Fetch data but don\'t update database')
    parser.add_argument('--run', action='store_true', help='Actually perform the update (required to prevent accidents)')

    args = parser.parse_args()

    if not args.dry_run and not args.run:
        print("\n[ERROR] You must specify either --dry-run or --run")
        print("\nExamples:")
        print("  python update_parcels_with_lir.py --dry-run          # Preview what will happen")
        print("  python update_parcels_with_lir.py --dry-run --limit 100  # Preview first 100")
        print("  python update_parcels_with_lir.py --run              # Actually update all parcels")
        print("  python update_parcels_with_lir.py --run --limit 1000 # Update first 1000 parcels\n")
        exit(1)

    # Run the update
    update_parcels_with_lir(limit=args.limit, dry_run=args.dry_run)
