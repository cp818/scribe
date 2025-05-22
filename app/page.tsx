'use client';

import { useState, useEffect, useRef } from 'react';
import SOAPNote from './components/SOAPNote';
import SimpleAudioRecorder from './components/SimpleAudioRecorder';
import TranscriptDisplay from './components/TranscriptDisplay';
import { SOAPNoteType } from './types';

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [soapNote, setSOAPNote] = useState<SOAPNoteType | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const toggleRecording = () => {
    setIsRecording(!isRecording);
    if (isRecording) {
      // Reset for new session
      setTranscript('');
      setSOAPNote(null);
    }
  };

  const handleTranscriptUpdate = (newTranscript: string) => {
    setTranscript(prev => prev + " " + newTranscript);
  };

  const handleSOAPNoteUpdate = (updatedNote: SOAPNoteType) => {
    setSOAPNote(updatedNote);
  };

  const handleSaveNote = async () => {
    // In a real app, this would save to Firestore or send to an EHR via FHIR
    alert("Note saved successfully!");
    console.log("Saved note:", soapNote);
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Medical Transcription</h2>
        <SimpleAudioRecorder 
          isRecording={isRecording}
          onToggleRecording={toggleRecording}
          onTranscriptUpdate={handleTranscriptUpdate}
          onSOAPNoteUpdate={handleSOAPNoteUpdate}
          onError={setError}
          onProcessingChange={setIsProcessing}
        />
        {error && <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Live Transcript</h2>
          <TranscriptDisplay transcript={transcript} />
        </div>

        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">SOAP Note</h2>
            <button 
              onClick={handleSaveNote}
              disabled={!soapNote || isProcessing}
              className={`btn ${(!soapNote || isProcessing) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Approve & Save
            </button>
          </div>
          
          <SOAPNote 
            note={soapNote} 
            isLoading={isProcessing}
          />
        </div>
      </div>
    </div>
  );
}
