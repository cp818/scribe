import { NextRequest } from 'next/server';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    // Get data from query parameter
    const searchParams = req.nextUrl.searchParams;
    const dataParam = searchParams.get('data');
    
    if (!dataParam) {
      return new Response(JSON.stringify({ error: 'Missing data parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const data = JSON.parse(decodeURIComponent(dataParam));
    const { transcript, previous_note } = data;
    
    if (!transcript) {
      return new Response(JSON.stringify({ error: 'Missing transcript' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

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

          // Prepare the messages for OpenAI with correct typing
          const messages = [
            { role: 'system', content: systemPrompt } as const,
            { 
              role: 'user', 
              content: JSON.stringify({
                transcript,
                previous_note
              })
            } as const
          ];

          // Call OpenAI with streaming
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini', // Could also use gpt-4o for higher accuracy
            messages: messages,
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
          
          // Send 'done' event to signal completion
          controller.enqueue(encoder.encode(`event: done\ndata: completed\n\n`));
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
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in SOAP note generation:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
