# Parcel Search Testing Guide

## Testing the Search Feature

### Where to Find It
1. Open your app in the browser
2. Look at the **Filters panel on the LEFT side**
3. Click the **"Parcel Search"** dropdown (should be below General Plan)

### Test Search 1: Find Vacant Parcels 2+ Acres

**Steps:**
1. Expand "Parcel Search" dropdown
2. Property Class: Select "Vacant" (hold Ctrl/Cmd to select)
3. Acreage: Enter "2" in Min field
4. Click "Search"

**Expected Result:**
- Should find hundreds of vacant parcels >=2 acres
- Orange highlighted parcels appear on map
- Yellow results box shows count
- "Export CSV" button appears

---

### Test Search 2: Find Residential Under $500k

**Steps:**
1. Click "Clear" to reset
2. Property Class: Select "Residential"
3. Market Value: Enter "500000" in Max $ field
4. Click "Search"

**Expected Result:**
- Should find many residential parcels valued under $500k
- Orange highlights on map

---

### Test Search 3: Find Vacant Land in Kaysville

**Steps:**
1. Click "Clear"
2. Property Class: Select "Vacant"
3. City: Select "Kaysville"
4. Click "Search"

**Expected Result:**
- Should find vacant parcels in Kaysville
- All results highlighted in orange

---

## Debugging

### If You Get "Statement Timeout" Error

**Check Browser Console (F12):**
Look for a line that says:
```
Search params: { min_acres: 2, ... }
```

This shows what parameters are being sent.

**Possible Causes:**
1. **Database still has old migration** - The `search_parcels` function might not be optimized
2. **Supabase timeout settings** - ANON key has shorter timeout than SERVICE key

**Quick Fix:**
Try this simpler search first:
- Property Class: "Vacant" ONLY
- No other filters
- Click Search

If this works, the function is fine. If it still times out, we need to check the database.

---

### If You Get "No parcels found"

**But you know parcels exist:**

**Check:**
1. Open browser console (F12)
2. Look at "Search params" log
3. Verify parameters match what you selected

**Common Issues:**
- Empty string `""` in Property Class array (filter out)
- `null` vs `undefined` confusion
- Array with single empty element `[""]`

---

## Verifying Data

### Check if LIR data is actually in database:

Run this in your Python environment:
```python
from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv('.env')
sb = create_client(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

# Count vacant parcels
result = sb.table('parcels').select('id', count='exact').eq('prop_class', 'Vacant').execute()
print(f"Vacant parcels in DB: {result.count}")

# Count parcels with acreage >= 2
result = sb.table('parcels').select('id', count='exact').gte('parcel_acres', 2).execute()
print(f"Parcels >= 2 acres: {result.count}")
```

Expected output:
```
Vacant parcels in DB: 13,458
Parcels >= 2 acres: ~30,000+
```

---

## Success Indicators

✅ **Search is working if:**
- Orange parcels appear on map
- Yellow results box shows count
- Export CSV downloads file with parcel data
- "Clear" button removes orange highlights

❌ **Search has issues if:**
- Timeout error (statement timeout)
- No results when you know parcels exist
- Error in browser console

---

## Next Steps

Once basic search works:

1. **Test Export CSV** - Click "Export CSV" button, verify file downloads
2. **Test Clear** - Click "Clear" button, verify orange highlights disappear
3. **Test Multiple Filters** - Combine Property Class + Acreage + Market Value
4. **Test Popup Click** - Click an orange highlighted parcel, verify popup shows details

---

## Console Logging

The search now logs to browser console:

```javascript
Search params: {
  min_acres: 2,
  max_acres: null,
  prop_classes: ["Vacant"],
  min_value: null,
  max_value: null,
  has_building: null,
  county_filter: "Davis",
  cities: null,
  result_limit: 1000
}
```

This helps debug what's being sent to Supabase.
