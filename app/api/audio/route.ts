import { NextRequest, NextResponse } from 'next/server';

// Using serverless function instead of edge runtime for better compatibility
export const config = {
  runtime: 'nodejs',
  api: {
    responseLimit: false,
  },
};

// Audio transcription endpoint that forwards to Deepgram
export async function POST(req: NextRequest) {
  try {
    // Add debug response headers to help troubleshoot
    const responseHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'X-Debug-Info': 'Deepgram transcription API',
    };

    // Extract audio data
    const audioData = await req.arrayBuffer();
    console.log(`Received audio data: ${audioData.byteLength} bytes`);
    
    if (audioData.byteLength === 0) {
      return NextResponse.json(
        { error: 'No audio data received' },
        { status: 400, headers: responseHeaders }
      );
    }
    
    // Check if we have an API key
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      console.error('Missing Deepgram API key');
      return NextResponse.json(
        { error: 'Configuration error: Missing API key' },
        { status: 500, headers: responseHeaders }
      );
    }
    
    // Set up the request to Deepgram's REST API
    const deepgramUrl = 'https://api.deepgram.com/v1/listen';
    
    // Construct URL with query parameters
    const url = new URL(deepgramUrl);
    url.searchParams.append('model', 'nova-3');
    url.searchParams.append('smart_format', 'true');
    url.searchParams.append('language', 'en-US');
    url.searchParams.append('encoding', 'linear16');
    url.searchParams.append('sample_rate', '48000');
    url.searchParams.append('channels', '1');
    
    console.log(`Sending request to Deepgram: ${url.toString()}`);
    
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: audioData
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Deepgram API error: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { error: `Transcription service error: ${response.status}` },
        { status: response.status, headers: responseHeaders }
      );
    }

    const transcription = await response.json();
    console.log('Transcription received successfully');
    
    return NextResponse.json(transcription, { headers: responseHeaders });
  } catch (err) {
    console.error('Error with transcription service:', err);
    return NextResponse.json(
      { error: 'Failed to process audio', details: err instanceof Error ? err.message : String(err) },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

// OPTIONS handler for CORS preflight requests
export async function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// GET endpoint to check if the service is up
export async function GET(req: NextRequest) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  const apiStatus = apiKey ? 'Configured' : 'Missing API Key';
  
  return NextResponse.json(
    { 
      status: 'Audio API is running', 
      config: apiStatus,
      timestamp: new Date().toISOString()
    },
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
