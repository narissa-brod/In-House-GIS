"""
Sync Landowner Data to Airtable
Once you get owner data from Davis County, this script will:
1. Read the owner CSV/Excel file
2. Match with parcel data
3. Create/update landowner records in Airtable
"""

import pandas as pd
import os
from dotenv import load_dotenv
import requests
from tqdm import tqdm
import time

# Load environment variables
load_dotenv('../.env')

AIRTABLE_TOKEN = os.getenv("VITE_AIRTABLE_TOKEN")
AIRTABLE_BASE = os.getenv("VITE_AIRTABLE_BASE")

# You'll need to create a "Landowners" table in Airtable
LANDOWNERS_TABLE = "Landowners"  # Change this to your actual table name

def read_owner_data(file_path):
    """
    Read owner data from CSV or Excel

    Args:
        file_path: Path to owner data file from county

    Returns:
        DataFrame with owner information
    """
    print(f"Reading owner data from: {file_path}")

    if file_path.endswith('.csv'):
        df = pd.read_csv(file_path)
    elif file_path.endswith(('.xlsx', '.xls')):
        df = pd.read_excel(file_path)
    else:
        raise ValueError("File must be CSV or Excel format")

    print(f"Loaded {len(df)} owner records")
    print(f"Columns: {list(df.columns)}")

    return df

def create_airtable_record(apn, owner_name, mailing_address, city, state, zip_code,
                          property_address=None, property_value=None):
    """
    Create or update a landowner record in Airtable

    Args:
        apn: Parcel ID
        owner_name: Owner full name
        mailing_address: Mailing street address
        city: City
        state: State
        zip_code: ZIP code
        property_address: Property address (optional)
        property_value: Assessed value (optional)

    Returns:
        Airtable record ID or None if failed
    """
    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE}/{LANDOWNERS_TABLE}"

    headers = {
        "Authorization": f"Bearer {AIRTABLE_TOKEN}",
        "Content-Type": "application/json"
    }

    # Construct the record
    record = {
        "fields": {
            "APN": str(apn),
            "Owner Name": str(owner_name) if owner_name else "",
            "Mailing Address": str(mailing_address) if mailing_address else "",
            "City": str(city) if city else "",
            "State": str(state) if state else "UT",
            "ZIP": str(zip_code) if zip_code else "",
        }
    }

    # Add optional fields if provided
    if property_address:
        record["fields"]["Property Address"] = str(property_address)
    if property_value:
        record["fields"]["Property Value"] = float(property_value)

    try:
        response = requests.post(url, json=record, headers=headers)

        if response.status_code == 200:
            return response.json()['id']
        elif response.status_code == 429:
            # Rate limit - wait and retry
            print("Rate limited, waiting...")
            time.sleep(30)
            return create_airtable_record(apn, owner_name, mailing_address, city,
                                        state, zip_code, property_address, property_value)
        else:
            print(f"Error creating record for APN {apn}: {response.text}")
            return None
    except Exception as e:
        print(f"Exception creating record for APN {apn}: {e}")
        return None

def sync_owners_to_airtable(owner_file_path,
                            apn_column='PARCEL_ID',
                            owner_column='OWNER_NAME',
                            mail_addr_column='MAIL_ADDR',
                            mail_city_column='MAIL_CITY',
                            mail_state_column='MAIL_STATE',
                            mail_zip_column='MAIL_ZIP',
                            property_addr_column=None,
                            property_value_column=None,
                            limit=None):
    """
    Sync owner data from county file to Airtable

    Args:
        owner_file_path: Path to CSV/Excel file from county
        *_column: Column names in the file (adjust based on actual file)
        limit: Max records to sync (for testing)
    """
    print("=" * 60)
    print("Landowner Data Sync - County Data → Airtable")
    print("=" * 60)

    # Read owner data
    df = read_owner_data(owner_file_path)

    if limit:
        print(f"Limiting to first {limit} records for testing")
        df = df.head(limit)

    # Check if columns exist
    required_cols = [apn_column, owner_column]
    missing = [col for col in required_cols if col not in df.columns]
    if missing:
        print(f"\nERROR: Missing required columns: {missing}")
        print(f"Available columns: {list(df.columns)}")
        return

    # Sync to Airtable
    success_count = 0
    failed_count = 0

    for idx, row in tqdm(df.iterrows(), total=len(df), desc="Syncing to Airtable"):
        apn = row.get(apn_column)
        owner_name = row.get(owner_column)
        mail_addr = row.get(mail_addr_column) if mail_addr_column in df.columns else None
        mail_city = row.get(mail_city_column) if mail_city_column in df.columns else None
        mail_state = row.get(mail_state_column) if mail_state_column in df.columns else 'UT'
        mail_zip = row.get(mail_zip_column) if mail_zip_column in df.columns else None
        prop_addr = row.get(property_addr_column) if property_addr_column and property_addr_column in df.columns else None
        prop_value = row.get(property_value_column) if property_value_column and property_value_column in df.columns else None

        # Skip if no APN or owner name
        if pd.isna(apn) or pd.isna(owner_name):
            failed_count += 1
            continue

        # Create record in Airtable
        record_id = create_airtable_record(
            apn=apn,
            owner_name=owner_name,
            mailing_address=mail_addr,
            city=mail_city,
            state=mail_state,
            zip_code=mail_zip,
            property_address=prop_addr,
            property_value=prop_value
        )

        if record_id:
            success_count += 1
        else:
            failed_count += 1

        # Rate limiting - Airtable allows 5 requests/second
        time.sleep(0.21)

    print("\n" + "=" * 60)
    print("Sync Complete!")
    print(f"  Successfully synced: {success_count}")
    print(f"  Failed: {failed_count}")
    print("=" * 60)

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Sync landowner data to Airtable')
    parser.add_argument('file', help='Path to owner data CSV/Excel file')
    parser.add_argument('--limit', type=int, help='Limit number of records (for testing)')

    args = parser.parse_args()

    # Adjust column names based on your actual file
    # Run with --limit 10 first to test!
    sync_owners_to_airtable(
        owner_file_path=args.file,
        limit=args.limit
    )
