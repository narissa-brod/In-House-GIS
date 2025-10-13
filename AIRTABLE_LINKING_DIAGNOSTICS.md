# Airtable Linking Diagnostics Guide

## Problem Summary
The Land ↔ Parcels linking is failing with 422 errors despite both tables having records.

## Enhanced Debugging Added

The code now includes comprehensive console logging to help diagnose the linking issue. When you run "Send to One Land Record", check your browser console for these logs:

### 1. Configuration Log (on page load)
```
🔧 Airtable Configuration
  Base ID: appsWI39rrzGmC2RH
  Land Table ID: tblXUjLqJLI5aXdsV
  Parcels Table ID: tblVAA4F7p6sjNLQx

  Land→Parcels Link Field:
    - Field Name: Parcel(s)
    - Field ID: (not set)
    - Using: Parcel(s) ⚠️ (Name)

  Parcels→Land Link Field:
    - Field Name: Land Database Link
    - Field ID: fldx01b0Bizc1t9k3
    - Using: fldx01b0Bizc1t9k3 ✅ (ID)
```

**What to check:**
- ✅ Field IDs (starting with `fld`) are more reliable than field names
- ⚠️ Field names can fail if they have special characters or spaces

### 2. Land→Parcels Link Attempt
```
🔗 Attempting Land→Parcels link:
  landRecordId: "recXXXXXXXXXX"
  fieldKey: "Parcel(s)"
  fieldIsId: false
  parcelIds: ["recYYYYYYYYYY", "recZZZZZZZZZZ"]
  payload: {...}
  tableId: "tblXUjLqJLI5aXdsV"
```

If it fails, you'll see:
```
❌ Land→Parcels link failed:
  status: 422
  response: {...}
  fieldKey: "Parcel(s)"
  error: {...}
```

### 3. Parcels→Land Link Attempt
```
🔗 Attempting Parcels→Land link:
  parcelsTableId: "tblVAA4F7p6sjNLQx"
  fieldKey: "fldx01b0Bizc1t9k3"
  fieldIsId: true
  landRecordId: "recXXXXXXXXXX"
  parcelCount: 2

  📦 Batch 1: Linking 2 parcels
  ✅ Batch 1 succeeded
```

## Common Causes of 422 Errors

### 1. **Field Type Mismatch** (Most Likely)
The field is NOT a "Link to another record" type in Airtable.

**How to check in Airtable:**
1. Open the Land Database table
2. Click the dropdown on the "Parcel(s)" column header
3. Select "Customize field type"
4. Check if it says:
   - ✅ **"Link to another record"** → pointing to Parcels table
   - ❌ **"Multiple select"** or **"Long text"** → This is the problem!

**Fix:** Change the field type to "Link to another record" and select the Parcels table.

### 2. **Wrong Target Table**
The link field points to a different table than the one you're writing to.

**How to check:**
1. In Airtable, open the field configuration for "Parcel(s)"
2. Verify it says "Link to records in: **Parcels**"
3. Check that the table ID matches `tblVAA4F7p6sjNLQx` (in your .env)

### 3. **Field Name Has Special Characters**
Field names with parentheses like `Parcel(s)` can sometimes cause issues.

**Fix:** Use the field ID instead:
1. In Airtable, click the dropdown on "Parcel(s)" column
2. Look at the URL - it will contain `fldXXXXXXXXXX`
3. Copy that field ID
4. Add to your `.env`:
   ```
   VITE_AIRTABLE_LAND_PARCELS_LINK_FIELD_ID=fldXXXXXXXXXX
   ```

### 4. **Permissions Issue**
Your API token doesn't have permission to write to that field.

**How to check:**
1. Go to https://airtable.com/create/tokens
2. Find your token (`patoN3L3f2UhWBWhv...`)
3. Verify it has `data.records:write` scope
4. Verify it has access to both tables

## Quick Diagnostic Tool (New!)

A helper function is now available in the browser console to fetch your Airtable schema automatically:

### Usage:

1. Open your app in the browser
2. Open browser console (F12)
3. Run:
   ```javascript
   debugAirtableSchema()  // Check Land Database table
   ```
   Or for Parcels table:
   ```javascript
   debugAirtableSchema('tblVAA4F7p6sjNLQx')
   ```

### What you'll see:

```
📋 Table: Land Database (tblXUjLqJLI5aXdsV)
Fields:
  - Name (fldXXXXXXX) - Type: singleLineText
  🔗 Parcel(s) (fldYYYYYYY)
     → Links to table: tblVAA4F7p6sjNLQx
     → Type: multipleRecordLinks
  - Property Address (fldZZZZZZZ) - Type: singleLineText
  ...

🔗 Link Fields Summary:
Parcel(s):
  Field ID: fldYYYYYYY
  Links to: tblVAA4F7p6sjNLQx
  To use in .env: VITE_AIRTABLE_..._FIELD_ID=fldYYYYYYY
```

**What this tells you:**
- ✅ If you see `🔗` and `Type: multipleRecordLinks` → Field is correctly configured
- ❌ If you see `Type: multipleSelect` or anything else → **This is your problem!**
- The correct field ID to use in your `.env` file

## Step-by-Step Troubleshooting

### Step 1: Check Field Types in Airtable

**Land Database table:**
- [ ] "Parcel(s)" field type: **Link to another record** → Parcels table
- [ ] Field allows linking to multiple records

**Parcels table:**
- [ ] "Land Database Link" field type: **Link to another record** → Land Database table
- [ ] Field allows linking to multiple records (or single record)

### Step 2: Get Field IDs (Recommended)

For the **Land Database** table:
1. Click on "Parcel(s)" column dropdown → look at URL for field ID
2. Add to `.env`: `VITE_AIRTABLE_LAND_PARCELS_LINK_FIELD_ID=fld...`

For the **Parcels** table:
1. You already have this: `fldx01b0Bizc1t9k3` ✅

### Step 3: Test Again

1. Reload the page
2. Check the console for the configuration log
3. Verify both fields show ✅ (ID)
4. Try "Send to One Land Record" again
5. Check console for success/failure logs

## Reading the Error Messages

When you see a 422 error, the `error` object will tell you exactly what's wrong:

```javascript
error: {
  type: "INVALID_VALUE_FOR_COLUMN",
  message: "Field 'Parcel(s)' cannot accept the provided value"
}
```

Common error types:
- `INVALID_VALUE_FOR_COLUMN` → Field type mismatch (not a link field)
- `INVALID_RECORDS` → Record IDs don't exist in the target table
- `INVALID_REQUEST_UNKNOWN` → Field name doesn't exist
- `INVALID_PERMISSIONS` → API token lacks write access

## What's in Your .env Currently

```env
VITE_AIRTABLE_BASE=appsWI39rrzGmC2RH
VITE_AIRTABLE_TABLE_ID=tblXUjLqJLI5aXdsV (Land Database)
VITE_AIRTABLE_PARCELS_TABLE_ID=tblVAA4F7p6sjNLQx (Parcels)

VITE_AIRTABLE_LAND_PARCELS_LINK_FIELD=Parcel(s)
VITE_AIRTABLE_LAND_PARCELS_LINK_FIELD_ID=(not set) ⚠️

VITE_AIRTABLE_PARCELS_LINK_TO_LAND_FIELD=Land Database Link
VITE_AIRTABLE_PARCELS_LINK_TO_LAND_FIELD_ID=fldx01b0Bizc1t9k3 ✅
```

## Next Steps

1. **Check browser console** when you test "Send to One Land Record"
2. **Copy the error details** from the console logs
3. **Verify field types** in Airtable (most likely culprit)
4. **Get the missing field ID** for "Parcel(s)" if needed
5. **Update .env** with the field ID
6. **Restart dev server** (`npm run dev`)

## Success Criteria

When it's working, you should see:
```
✅ Land→Parcels link succeeded
✅ Batch 1 succeeded
Created Land record with 2 parcels
```

And in Airtable:
- The Land record shows linked Parcel records
- The Parcel records show the linked Land record
