# Helix-Scribe

A real-time medical transcription application that captures live clinician-patient audio, transcribes it in real time, and generates structured SOAP notes.

## Features

- Real-time audio capture with microphone access
- Streaming speech-to-text transcription using Deepgram Nova-3
- Automated SOAP note generation using OpenAI GPT-4o/4o-mini
- Live note updates with JSON diffing to avoid flicker
- Editable notes with approval and save functionality

## Tech Stack

- **Frontend:** Next.js (React) with TypeScript and Tailwind CSS
- **Transcription:** Deepgram Nova-3 Conversational API
- **SOAP Note Generation:** OpenAI GPT-4o-mini (can be upgraded to GPT-4o for higher accuracy)
- **Audio Processing:** Browser MediaRecorder API
- **Data Streaming:** Server-Sent Events (SSE) for incremental updates

## Setup

### Prerequisites

- Node.js 18+ and npm/pnpm
- Deepgram API Key
- OpenAI API Key

### Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```
DEEPGRAM_API_KEY=your_deepgram_api_key
OPENAI_API_KEY=your_openai_api_key
```

### Installation

```bash
# Install dependencies
pnpm install
# or
npm install

# Run the development server
pnpm dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## Usage

1. Click "Start Recording" to begin capturing audio
2. Speak clearly - the transcript will appear in real-time
3. A SOAP note will be generated and continuously updated
4. Edit the note if needed by clicking "Edit Note"
5. Click "Approve & Save" when the note is finalized

## Deployment

This application is configured for deployment on Vercel:

```bash
vercel --prod
```

### Environment Variables on Vercel

Make sure to set the following environment variables in your Vercel project settings:

- `DEEPGRAM_API_KEY`
- `OPENAI_API_KEY`

## Project Structure

- `/app` - Next.js app router structure
  - `/api/audio` - Deepgram audio processing API endpoint
  - `/api/soap` - OpenAI SOAP note generation endpoint
  - `/components` - React components
- `/public` - Static assets

## SOAP Note Format

The application generates SOAP notes with the following structure:

```json
{
  "metadata": {
    "patient_name": "string | null",
    "clinician_name": "string | null",
    "visit_datetime": "ISO-8601 UTC string",
    "chief_complaint": "string | null",
    "medications_list": ["array", "of", "strings"]
  },
  "subjective": "string",
  "objective": "string",
  "assessment": "string",
  "plan": "string",
  "diff": ["array", "of", "changed", "lines"]
}
```

## Future Enhancements

- Integration with EHR systems via FHIR
- Firebase/Firestore for note persistence
- Custom domain and SSL configuration
- Multi-language support
- Template system for different medical specialties
