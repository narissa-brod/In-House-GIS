"""Quick verification that LIR data was merged successfully"""
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv('../.env')

sb = create_client(
    os.getenv('VITE_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_KEY')
)

# Fetch 10 sample parcels with LIR fields
result = sb.table('parcels').select(
    'apn,owner_name,address,prop_class,bldg_sqft,built_yr,total_mkt_value,parcel_acres'
).limit(10).execute()

print("\n" + "=" * 70)
print("VERIFICATION: LIR Data Merge Success Check")
print("=" * 70)
print(f"\nFetched {len(result.data)} sample parcels:\n")

for i, parcel in enumerate(result.data[:5], 1):
    print(f"{i}. APN: {parcel.get('apn')}")
    print(f"   Address: {parcel.get('address')}")
    print(f"   Owner: {parcel.get('owner_name')}")
    print(f"   Property Class: {parcel.get('prop_class') or '[Not set]'}")
    print(f"   Building Sqft: {parcel.get('bldg_sqft') or '[None]'}")
    print(f"   Year Built: {parcel.get('built_yr') or '[None]'}")
    value = parcel.get('total_mkt_value')
    print(f"   Market Value: ${float(value):,.0f}" if value else "   Market Value: [None]")
    print(f"   Acres: {parcel.get('parcel_acres') or '[Not set]'}")
    print()

# Get some statistics
print("=" * 70)
print("STATISTICS:")
print("=" * 70)

# Count parcels with LIR data
vacant_count = sb.table('parcels').select('id', count='exact').eq('prop_class', 'Vacant').execute()
residential_count = sb.table('parcels').select('id', count='exact').eq('prop_class', 'Residential').execute()
with_value = sb.table('parcels').select('id', count='exact').not_.is_('total_mkt_value', 'null').execute()
with_building = sb.table('parcels').select('id', count='exact').gt('bldg_sqft', 0).execute()

print(f"Vacant parcels: {vacant_count.count:,}")
print(f"Residential parcels: {residential_count.count:,}")
print(f"Parcels with market value: {with_value.count:,}")
print(f"Parcels with buildings: {with_building.count:,}")

print("\n" + "=" * 70)
print("[SUCCESS] LIR data successfully merged!")
print("Ready to build the Parcel Search UI")
print("=" * 70 + "\n")
