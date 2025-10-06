# Airtable "View on Map" Setup

This guide shows you how to add a clickable "View on Map" button in your Airtable Land Database that opens the parcel directly on your map.

## Setup Instructions

### 1. Get Your Vercel URL

After deploying with Vercel, your app URL will be something like:
- `https://your-app-name.vercel.app`

Replace `your-app-name` with your actual Vercel app name in the formulas below.

### 2. Add Formula Field in Airtable

Go to your Land Database table in Airtable and create a new **Formula** field:

**Field Name:** `View on Map`

**Formula Option 1 - Using APN (Recommended):**
```
"https://your-app-name.vercel.app?apn=" & {APN}
```

**Formula Option 2 - Using Property Address:**
```
"https://your-app-name.vercel.app?address=" & ENCODE_URL_COMPONENT({Property Address})
```

**Formula Option 3 - Fallback (tries APN first, then address):**
```
IF(
  {APN},
  "https://your-app-name.vercel.app?apn=" & {APN},
  IF(
    {Property Address},
    "https://your-app-name.vercel.app?address=" & ENCODE_URL_COMPONENT({Property Address}),
    ""
  )
)
```

### 3. Format as Button (Optional)

1. Click on the field name → **Customize field type**
2. Change formatting to **Button**
3. Set **Label:** "🗺️ View on Map"
4. Set **URL:** Use the formula column you just created

### 4. How It Works

When someone clicks the "View on Map" button in Airtable:

1. Opens your map application
2. Automatically enables the Davis County Parcels layer
3. Zooms to the specific parcel (zoom level 18)
4. Opens the parcel info popup with all details
5. User can then click "Add to Land Database" if not already added

## URL Parameters Supported

Your app now supports these URL parameters:

- `?apn=020140006` - Navigate to parcel by APN
- `?address=250+NORTH+MAIN+ST` - Navigate to parcel by address (partial match)

## Example URLs

```
https://your-app-name.vercel.app?apn=020140006
https://your-app-name.vercel.app?address=250+NORTH+MAIN+ST
https://your-app-name.vercel.app?address=Centerville
```

## Testing

1. Add the formula field to your Airtable
2. Click on any "View on Map" link
3. The map should open and zoom to that parcel
4. After 2 seconds, the parcel popup should automatically open

## Troubleshooting

**Parcel not found:**
- Make sure the APN in Airtable exactly matches the APN in your Supabase parcels table
- For addresses, the search uses partial matching (case-insensitive)

**Map doesn't zoom:**
- Check browser console for errors
- Ensure you've imported all Davis County parcels to Supabase

**Popup doesn't open:**
- The parcel must be visible on the map (zoom level 14+)
- Wait 2-3 seconds for parcels to load before the popup triggers
