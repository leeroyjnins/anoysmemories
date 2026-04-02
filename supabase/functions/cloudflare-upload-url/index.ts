import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const accountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID')
    const apiToken = Deno.env.get('CLOUDFLARE_API_TOKEN')

    if (!accountId || !apiToken) {
      throw new Error('Cloudflare credentials not configured')
    }

    let requestData = {}
    if (req.headers.get('content-type')?.includes('application/json')) {
      try {
        requestData = await req.json()
      } catch (e) {}
    }
    const uploadLength = requestData.uploadLength?.toString() || req.headers.get('Upload-Length') || '1'

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream?direct_user=true`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Tus-Resumable': '1.0.0',
          'Upload-Length': uploadLength,
          'Upload-Metadata': req.headers.get('Upload-Metadata') || '',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Cloudflare API error: ${response.statusText}`)
    }

    const location = response.headers.get('Location')
    if (!location) {
      throw new Error('No Location header in Cloudflare response')
    }

    return new Response(
      JSON.stringify({ uploadUrl: location }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
