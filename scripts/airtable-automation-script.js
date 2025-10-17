/**
 * Airtable Automation Script
 *
 * This script geocodes a new/updated address and saves it to Supabase geocodes table.
 *
 * Setup in Airtable:
 * 1. Go to Automations
 * 2. Trigger: "When record created or updated"
 * 3. Add condition: "Property Address is not empty"
 * 4. Action: "Run script" and paste this code
 * 5. Configure input variables (see below)
 *
 * Required Input Variables:
 * - record: The triggering record (from trigger step)
 * - GOOGLE_MAPS_API_KEY: Your Google Maps API key
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_SERVICE_KEY: Your Supabase service role key
 */

// Get input variables from the automation
let inputConfig = input.config();
let record = inputConfig.record;
let GOOGLE_MAPS_API_KEY = inputConfig.GOOGLE_MAPS_API_KEY;
let SUPABASE_URL = inputConfig.SUPABASE_URL;
let SUPABASE_SERVICE_KEY = inputConfig.SUPABASE_SERVICE_KEY;

// Get the address from the record
// Note: In Airtable automations, record is passed as a plain object with fields
let propertyAddress = inputConfig.propertyAddress || inputConfig["Property Address"];
let city = inputConfig.city || inputConfig.City;
let address = propertyAddress;

if (!address) {
    console.log("No address to geocode");
    output.set('result', 'No address provided');
} else {
    // Normalize address (uppercase, add Utah)
    let fullAddress = `${address}${city ? ', ' + city : ''}, Utah`;
    let normalizedAddress = fullAddress.toUpperCase().trim();

    console.log(`Geocoding: ${normalizedAddress}`);

    // Check if already cached in Supabase
    let checkResponse = await fetch(`${SUPABASE_URL}/rest/v1/geocodes?address=eq.${encodeURIComponent(normalizedAddress)}&select=lat,lng`, {
        method: 'GET',
        headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    let existingCache = await checkResponse.json();

    if (existingCache && existingCache.length > 0) {
        console.log(`Address already cached: ${existingCache[0].lat}, ${existingCache[0].lng}`);
        output.set('result', 'Already cached');
    } else {
        // Geocode with Google Maps API
        let geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${GOOGLE_MAPS_API_KEY}`;

        let geocodeResponse = await fetch(geocodeUrl);
        let geocodeData = await geocodeResponse.json();

        if (geocodeData.status === 'OK' && geocodeData.results.length > 0) {
            let location = geocodeData.results[0].geometry.location;
            let lat = location.lat;
            let lng = location.lng;

            console.log(`Geocoded to: ${lat}, ${lng}`);

            // Save to Supabase geocodes table
            let saveResponse = await fetch(`${SUPABASE_URL}/rest/v1/geocodes`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify({
                    address: normalizedAddress,
                    lat: lat,
                    lng: lng
                })
            });

            if (saveResponse.ok) {
                console.log('Saved to Supabase cache');
                output.set('result', `Geocoded and cached: ${lat}, ${lng}`);
            } else {
                let errorText = await saveResponse.text();
                console.error('Failed to save to Supabase:', errorText);
                output.set('result', 'Failed to cache');
            }
        } else {
            console.error('Geocoding failed:', geocodeData.status);
            output.set('result', 'Geocoding failed');
        }
    }
}
