# Airtable Linking Diagnostic Changes

## What I Added

### 1. Enhanced Console Logging in `linkToOneLandRecord()`

**Location:** [Map.vue:467-553](src/components/Map.vue#L467-L553)

Added detailed logging for both linking directions:

#### Land → Parcels Link Logging
- Shows the payload being sent
- Displays field key (name vs ID)
- Shows parcel record IDs being linked
- Reports success/failure with full error details
- Logs fallback attempts if initial link fails

#### Parcels → Land Link Logging
- Shows configuration and batch details
- Reports per-batch success/failure
- Displays full error responses from Airtable

### 2. Startup Configuration Diagnostic

**Location:** [Map.vue:786-805](src/components/Map.vue#L786-L805)

Added `logAirtableConfig()` function that runs on page load and displays:
- Base and table IDs
- Field names and IDs for both link directions
- Whether using field ID (✅) or field name (⚠️)

### 3. Browser Console Schema Inspector

**Location:** [Map.vue:807-857](src/components/Map.vue#L807-L857)

Added `debugAirtableSchema()` function accessible from browser console:
- Fetches table metadata directly from Airtable
- Shows all fields with their types and IDs
- Highlights link fields specifically
- Provides exact field IDs for `.env` configuration

**Usage:**
```javascript
debugAirtableSchema()  // Check Land table
debugAirtableSchema('tblVAA4F7p6sjNLQx')  // Check Parcels table
```

### 4. Diagnostic Documentation

**New file:** [AIRTABLE_LINKING_DIAGNOSTICS.md](AIRTABLE_LINKING_DIAGNOSTICS.md)

Comprehensive guide covering:
- How to read the console logs
- Common causes of 422 errors
- Step-by-step troubleshooting
- How to use the new diagnostic tools
- What to check in Airtable

## How to Use These Diagnostics

### Step 1: Check Configuration (Automatic)
1. Load the app
2. Open browser console (F12)
3. Look for "🔧 Airtable Configuration" log
4. Note any ⚠️ warnings about using field names instead of IDs

### Step 2: Inspect Table Schemas
In browser console, run:
```javascript
debugAirtableSchema()  // Land Database table
```

Look for the "Parcel(s)" field:
- ✅ **Good:** `Type: multipleRecordLinks` → Links to table: tblVAA4F7p6sjNLQx
- ❌ **Problem:** `Type: multipleSelect` or `Type: singleLineText`

### Step 3: Test Linking
1. Select some parcels
2. Click "Send to One Land Record"
3. Enter a name
4. Watch the console for:
   - 🔗 Link attempt logs
   - ✅ Success messages
   - ❌ Error details with Airtable's response

### Step 4: Fix Based on Errors

**If you see field type mismatch:**
1. Go to Airtable
2. Change "Parcel(s)" field type to "Link to another record"
3. Select the Parcels table

**If field name isn't working:**
1. Get the field ID from `debugAirtableSchema()`
2. Add to `.env`:
   ```
   VITE_AIRTABLE_LAND_PARCELS_LINK_FIELD_ID=fldXXXXXXXXXX
   ```
3. Restart dev server

## Expected Behavior When Working

### Console Output:
```
🔧 Airtable Configuration
  Land→Parcels Link Field:
    - Using: fldXXXXXXXXXX ✅ (ID)
  Parcels→Land Link Field:
    - Using: fldx01b0Bizc1t9k3 ✅ (ID)

🔗 Attempting Land→Parcels link:
  fieldIsId: true
  parcelIds: ["recAAA", "recBBB"]
✅ Land→Parcels link succeeded

🔗 Attempting Parcels→Land link:
  parcelCount: 2
  📦 Batch 1: Linking 2 parcels
  ✅ Batch 1 succeeded
```

### In Airtable:
- Land record shows 2 linked Parcel records
- Both Parcel records show the linked Land record

## Most Likely Issue

Based on your `.env`, the "Parcel(s)" field is being accessed by name, not ID:
```
VITE_AIRTABLE_LAND_PARCELS_LINK_FIELD=Parcel(s)
VITE_AIRTABLE_LAND_PARCELS_LINK_FIELD_ID=(not set)  ⚠️
```

**The field name `Parcel(s)` with parentheses might cause issues.**

**Solution:** Run `debugAirtableSchema()` to get the correct field ID, then add it to `.env`.

## Files Modified

1. `src/components/Map.vue` - Added diagnostic logging and schema inspector
2. `AIRTABLE_LINKING_DIAGNOSTICS.md` - Troubleshooting guide (new)
3. `CHANGES_SUMMARY.md` - This file (new)

## No Breaking Changes

All changes are additive:
- Existing functionality unchanged
- Only added logging and diagnostic helpers
- No changes to linking logic itself
