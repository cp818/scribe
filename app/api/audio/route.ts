import { NextRequest } from 'next/server';

export const runtime = 'edge';

// Since Edge Runtime doesn't support direct WebSocket handling, we'll need a different approach
// This implementation uses a proxy pattern to forward requests to Deepgram
export async function POST(req: NextRequest) {
  try {
    const audioData = await req.arrayBuffer();
    
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
    url.searchParams.append('interim_results', 'true');
    
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.DEEPGRAM_API_KEY || ''}`,
        'Content-Type': 'audio/wav',  // Adjust based on your audio format
      },
      body: audioData
    });

    if (!response.ok) {
      throw new Error(`Deepgram API error: ${response.status}`);
    }

    const transcription = await response.json();
    return new Response(JSON.stringify(transcription), {
      headers: {
        'Content-Type': 'application/json'
      },
    });
  } catch (err) {
    console.error('Error with transcription service:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to process audio' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

// We'll support a simple GET endpoint to check if the service is up
export async function GET(req: NextRequest) {
  return new Response(
    JSON.stringify({ status: 'Audio API is running' }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}
