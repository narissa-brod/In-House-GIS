/**
 * Supabase Edge Function: Airtable Geocode Sync
 *
 * This function receives webhooks from Airtable when records are created/updated,
 * geocodes the address, and saves it to the geocodes table.
 *
 * Setup in Airtable:
 * 1. Create Automation with trigger "When record created or updated"
 * 2. Add action "Send webhook"
 * 3. URL: https://your-project.supabase.co/functions/v1/airtable-geocode-sync
 * 4. Method: POST
 * 5. Body: JSON with address data
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    })
  }

  try {
    const body = await req.json()

    // Extract address from Airtable webhook payload
    const propertyAddress = body.address || body['Property Address'] || body.propertyAddress
    const city = body.city || body.City

    if (!propertyAddress) {
      return new Response(
        JSON.stringify({ error: 'No address provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Normalize address
    const fullAddress = `${propertyAddress}${city ? ', ' + city : ''}, Utah`
    const normalizedAddress = fullAddress.toUpperCase().trim()

    console.log(`Processing address: ${normalizedAddress}`)

    // Check if already cached
    const { data: existing } = await supabase
      .from('geocodes')
      .select('lat, lng')
      .eq('address', normalizedAddress)
      .maybeSingle()

    if (existing) {
      console.log(`Already cached: ${existing.lat}, ${existing.lng}`)
      return new Response(
        JSON.stringify({
          cached: true,
          lat: existing.lat,
          lng: existing.lng
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      )
    }

    // Geocode with Google Maps API
    if (!GOOGLE_MAPS_API_KEY) {
      throw new Error('GOOGLE_MAPS_API_KEY not configured')
    }

    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${GOOGLE_MAPS_API_KEY}`
    const geocodeResponse = await fetch(geocodeUrl)
    const geocodeData = await geocodeResponse.json()

    if (geocodeData.status !== 'OK' || !geocodeData.results?.length) {
      throw new Error(`Geocoding failed: ${geocodeData.status}`)
    }

    const location = geocodeData.results[0].geometry.location
    const lat = location.lat
    const lng = location.lng

    console.log(`Geocoded to: ${lat}, ${lng}`)

    // Save to geocodes table
    const { error: insertError } = await supabase
      .from('geocodes')
      .upsert(
        { address: normalizedAddress, lat, lng },
        { onConflict: 'address' }
      )

    if (insertError) {
      throw insertError
    }

    console.log('Saved to cache successfully')

    return new Response(
      JSON.stringify({
        success: true,
        geocoded: true,
        address: normalizedAddress,
        lat,
        lng
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
})
