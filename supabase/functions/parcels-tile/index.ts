// Supabase Edge Function to serve Mapbox Vector Tiles with correct headers
// Deploy: supabase functions deploy parcels-tile

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// CORS headers for tile requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MVT_CONTENT_TYPE = 'application/vnd.mapbox-vector-tile'

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse tile coordinates from URL
    const url = new URL(req.url)
    const z = parseInt(url.searchParams.get('z') || '0')
    const x = parseInt(url.searchParams.get('x') || '0')
    const y = parseInt(url.searchParams.get('y') || '0')

    // Validate tile coordinates
    if (z < 0 || z > 22 || x < 0 || y < 0) {
      return new Response('Invalid tile coordinates', {
        status: 400,
        headers: corsHeaders
      })
    }

    // Only serve tiles at certain zoom levels to reduce load
    if (z < 10 || z > 20) {
      // Return 204 No Content for out-of-range zooms
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      })
    }

    // Create Supabase client with service role key for database access
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        }
      }
    )

    // Call the parcels_tile function using direct fetch for better bytea handling
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const rpcUrl = `${supabaseUrl}/rest/v1/rpc/parcels_tile`
    const rpcResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ z, x, y })
    })

    if (!rpcResponse.ok) {
      const errorText = await rpcResponse.text()
      console.error('RPC error:', errorText)
      return new Response(JSON.stringify({ error: errorText }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        }
      })
    }

    // PostgREST returns bytea as a hex-encoded string (prefixed with \x)
    const rawText = await rpcResponse.text()

    let tileData = new Uint8Array(0)
    let payload = rawText.trim()

    // Attempt to parse JSON wrapper (PostgREST may return {"parcels_tile":"\\x..."} or a bare string)
    if (payload.startsWith('{')) {
      try {
        const parsed = JSON.parse(payload)
        const value = parsed?.parcels_tile ?? parsed?.data ?? parsed
        if (typeof value === 'string') {
          payload = value
        }
      } catch {
        // Ignore JSON parse errors; fall back to raw payload
      }
    }

    if (payload.startsWith('"') && payload.endsWith('"')) {
      payload = payload.slice(1, -1)
    }

    if (payload.length > 0) {
      let candidate = payload.trim()

      // Remove any JSON escaping (e.g., \\x -> \x)
      while (candidate.startsWith('\\')) {
        candidate = candidate.slice(1)
      }

      let hexCandidate = candidate
      if (hexCandidate.startsWith('x') || hexCandidate.startsWith('X')) {
        hexCandidate = hexCandidate.slice(1)
      }
      const isHex = /^[0-9a-fA-F]+$/.test(hexCandidate)

      if (isHex) {
        let hex = hexCandidate
        if (hex.length % 2 === 1) {
          hex = hex.slice(0, -1)
        }
        const bytes = new Uint8Array(hex.length / 2)
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
        }
        tileData = bytes
      } else {
        // Fallback: treat as base64 if not hex-encoded
        try {
          const binaryString = atob(candidate)
          const bytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          tileData = bytes
        } catch (e) {
          console.error('Tile decode error:', e)
          tileData = new Uint8Array(0)
        }
      }
    }

    // Return empty for tiles with no features
    if (!tileData || tileData.length === 0) {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    // Return raw MVT (protobuf) with the correct MIME type
    return new Response(tileData, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': MVT_CONTENT_TYPE,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
        'Content-Length': String(tileData.length),
        'X-Tile-Coordinates': `${z}/${x}/${y}`,
      }
    })

  } catch (err) {
    console.error('Error serving tile:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      }
    })
  }
})
