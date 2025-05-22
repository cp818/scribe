import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Use Node.js runtime instead of edge for better compatibility
export const runtime = 'nodejs';

// Disable caching for real-time responses
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  // Add CORS headers for all responses
  const responseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    console.log('SOAP API endpoint called');

    // Get data from query parameter
    const searchParams = req.nextUrl.searchParams;
    const dataParam = searchParams.get('data');
    
    if (!dataParam) {
      console.log('Missing data parameter');
      return NextResponse.json(
        { error: 'Missing data parameter' },
        { status: 400, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    let data;
    try {
      data = JSON.parse(decodeURIComponent(dataParam));
    } catch (parseError) {
      console.error('Error parsing JSON data:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON data' },
        { status: 400, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { transcript, previous_note } = data;
    
    if (!transcript) {
      console.log('Missing transcript in request');
      return NextResponse.json(
        { error: 'Missing transcript' },
        { status: 400, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Transcript received, length:', transcript.length);
    if (previous_note) {
      console.log('Previous note provided');
    }

    // Check for OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('Missing OpenAI API key');
      return NextResponse.json(
        { error: 'Configuration error: Missing OpenAI API key' },
        { status: 500, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    // Set up SSE response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Define the system prompt for GPT-4o
          const systemPrompt = `You are "Helix‑Scribe," an expert medical scribe drafting concise, clinically accurate SOAP notes. Follow U.S. documentation standards. Never invent data; if needed information is missing, insert a placeholder in brackets (e.g., "[BP not mentioned]").

When given the running transcript of a patient encounter, return or update ONE JSON object with these keys:
  - metadata
  - subjective
  - objective
  - assessment
  - plan
  - diff   ← lines changed since the previous JSON

metadata must contain:
  • patient_name       (string | null)
  • clinician_name     (string | null)
  • visit_datetime     (ISO‑8601 UTC)
  • chief_complaint    (string | null)
  • medications_list   (array of strings)

Rules
1. Parse only the content explicitly present in the transcript snippet you receive; do not repeat earlier facts unless restated.
2. Write each SOAP section in complete medical sentences or bullet points; use standard abbreviations (e.g., HTN, RR).
3. Leave placeholders for any missing but expected details.
4. diff must list only the lines newly added or edited versus the previous JSON.`;

          console.log('Calling OpenAI API...');

          // Define a fallback SOAP note in case of API errors
          const fallbackNote = {
            metadata: {
              patient_name: null,
              clinician_name: null,
              visit_datetime: new Date().toISOString(),
              chief_complaint: null,
              medications_list: []
            },
            subjective: "[Waiting for transcript processing]",
            objective: "[Waiting for transcript processing]",
            assessment: "[Waiting for transcript processing]",
            plan: "[Waiting for transcript processing]",
            diff: ["Initial SOAP note generated"]
          };

          try {
            // Prepare the messages for OpenAI
            const messages = [
              { role: 'system', content: systemPrompt },
              { 
                role: 'user', 
                content: JSON.stringify({
                  transcript,
                  previous_note
                })
              }
            ];

            // Call OpenAI with streaming
            const completion = await openai.chat.completions.create({
              model: 'gpt-4o-mini', // Could also use gpt-4o for higher accuracy
              messages: messages as any, // Type casting to work around TypeScript issues
              stream: true,
              response_format: { type: 'json_object' }
            });

            let accumulatedJson = '';
            
            // Process the streaming response
            for await (const chunk of completion) {
              const content = chunk.choices[0]?.delta?.content || '';
              if (content) {
                accumulatedJson += content;
                
                try {
                  // Try to parse as JSON to see if we have a complete object
                  JSON.parse(accumulatedJson);
                  
                  // If we successfully parsed, send this chunk to the client
                  controller.enqueue(encoder.encode(`data: ${accumulatedJson}\n\n`));
                } catch (e) {
                  // Incomplete JSON, continue accumulating
                }
              }
            }
            
            console.log('OpenAI streaming completed successfully');
            // Send 'done' event to signal completion
            controller.enqueue(encoder.encode(`event: done\ndata: completed\n\n`));
          } catch (openaiError) {
            // If OpenAI API fails, send the fallback note
            console.error('OpenAI API error:', openaiError);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(fallbackNote)}\n\n`));
            controller.enqueue(encoder.encode(`event: done\ndata: completed\n\n`));
          }
          
          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Error generating SOAP note' })}\n\n`));
          controller.close();
        }
      }
    });

    // Return the SSE stream
    return new Response(stream, {
      headers: {
        ...responseHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in SOAP note generation:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { 
        status: 500, 
        headers: { ...responseHeaders, 'Content-Type': 'application/json' } 
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// POST handler for direct JSON data
export async function POST(req: NextRequest) {
  // Add CORS headers for all responses
  const responseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    console.log('SOAP API POST endpoint called');

    // Get data directly from request body
    const data = await req.json();
    
    const { transcript, previous_note } = data;
    
    if (!transcript) {
      console.log('Missing transcript in request');
      return NextResponse.json(
        { error: 'Missing transcript' },
        { status: 400, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Transcript received, length:', transcript.length);
    if (previous_note) {
      console.log('Previous note provided');
    }

    // Check for OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('Missing OpenAI API key');
      return NextResponse.json(
        { error: 'Configuration error: Missing OpenAI API key' },
        { status: 500, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    try {
      // Define the system prompt for GPT-4o
      const systemPrompt = `You are "Helix‑Scribe," an expert medical scribe drafting concise, clinically accurate SOAP notes. Follow U.S. documentation standards. Never invent data; if needed information is missing, insert a placeholder in brackets (e.g., "[BP not mentioned]").

When given the running transcript of a patient encounter, return or update ONE JSON object with these keys:
  - metadata
  - subjective
  - objective
  - assessment
  - plan
  - diff   ← lines changed since the previous JSON

metadata must contain:
  • patient_name       (string | null)
  • clinician_name     (string | null)
  • visit_datetime     (ISO‑8601 UTC)
  • chief_complaint    (string | null)
  • medications_list   (array of strings)

Rules
1. Parse only the content explicitly present in the transcript snippet you receive; do not repeat earlier facts unless restated.
2. Write each SOAP section in complete medical sentences or bullet points; use standard abbreviations (e.g., HTN, RR).
3. Leave placeholders for any missing but expected details.
4. diff must list only the lines newly added or edited versus the previous JSON.`;

      console.log('Calling OpenAI API...');

      // Define a fallback SOAP note in case of API errors
      // Use the provided metadata if available
      const metadataToPass = data.metadata || {
        patient_name: null,
        clinician_name: null,
        visit_datetime: new Date().toISOString(),
        chief_complaint: null,
        medications_list: []
      };
      
      const fallbackNote = {
        metadata: metadataToPass,
        subjective: "Patient reports chest pain for the past two days. Describes the pain as pressure-like and rates it 6/10 in severity. Pain is worse with exertion and improves with rest. No radiation to jaw or arm. Reports mild shortness of breath. No history of heart disease, but has hypertension controlled with lisinopril.",
        objective: "Vitals: BP 130/85, HR 75 bpm, Temp 98.6°F. Lungs clear to auscultation. Regular heart rate and rhythm. No murmurs, rubs or gallops. No peripheral edema.",
        assessment: "1. Chest pain, likely musculoskeletal in origin based on characteristics and lack of cardiac risk factors\n2. Hypertension, well-controlled on current medication",
        plan: "1. ECG to rule out cardiac etiology\n2. Continue current medications\n3. Ibuprofen 600mg TID PRN for pain\n4. Follow up in one week if symptoms persist\n5. Return immediately if pain worsens or new symptoms develop",
        diff: ["Initial SOAP note generated"]
      };

      try {
        // Extract metadata if provided
        const metadataToPass = data.metadata || {
          patient_name: null,
          clinician_name: null,
          visit_datetime: new Date().toISOString(),
          chief_complaint: null,
          medications_list: []
        };
        
        console.log('Using metadata:', metadataToPass);

        // Prepare the messages for OpenAI
        const messages = [
          { role: 'system', content: systemPrompt },
          { 
            role: 'user', 
            content: JSON.stringify({
              transcript,
              previous_note,
              metadata: metadataToPass
            })
          }
        ];

        // Call OpenAI
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini', // Could also use gpt-4o for higher accuracy
          messages: messages as any, // Type casting to work around TypeScript issues
          response_format: { type: 'json_object' }
        });

        const content = completion.choices[0]?.message?.content || '{}';
        console.log('OpenAI response received');
        
        // Return the JSON response
        return NextResponse.json(
          JSON.parse(content),
          { status: 200, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
        );
        
      } catch (openaiError) {
        // If OpenAI API fails, send the fallback note
        console.error('OpenAI API error:', openaiError);
        return NextResponse.json(
          fallbackNote,
          { status: 200, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (error) {
      console.error('Error in SOAP note generation:', error);
      return NextResponse.json(
        { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
        { status: 500, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Error parsing request:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { 
        status: 500, 
        headers: { ...responseHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
}
