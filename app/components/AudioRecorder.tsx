'use client';

import { useEffect, useRef, useState } from 'react';
import { SOAPNoteType } from '../types';

interface AudioRecorderProps {
  isRecording: boolean;
  onToggleRecording: () => void;
  onTranscriptUpdate: (transcript: string) => void;
  onSOAPNoteUpdate: (note: SOAPNoteType) => void;
  onError: (error: string | null) => void;
  onProcessingChange: (isProcessing: boolean) => void;
}

export default function AudioRecorder({
  isRecording,
  onToggleRecording,
  onTranscriptUpdate,
  onSOAPNoteUpdate,
  onError,
  onProcessingChange,
}: AudioRecorderProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micAccessGranted = useRef(false);
  const lastNoteUpdateTime = useRef<number>(0);
  const pendingTranscript = useRef<string>('');
  const currentSOAPNote = useRef<SOAPNoteType | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const [recordingTime, setRecordingTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const processingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Start or stop recording based on isRecording prop
    if (isRecording) {
      startRecording();
    } else {
      stopRecording();
    }

    // Cleanup function to ensure everything is properly stopped
    return () => {
      stopRecording();
    };
  }, [isRecording]);

  const requestMicrophoneAccess = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      micAccessGranted.current = true;
      onError(null);
      return stream;
    } catch (err) {
      console.error('Error accessing microphone:', err);
      onError('Could not access microphone. Please check your browser permissions.');
      return null;
    }
  };

  const startRecording = async () => {
    try {
      onError(null);
      
      // If we don't have microphone access yet, request it
      if (!micAccessGranted.current) {
        const stream = await requestMicrophoneAccess();
        if (!stream) return;
      }

      if (!streamRef.current) {
        console.error('No audio stream available');
        return;
      }

      // Reset state for new recording session
      pendingTranscript.current = '';
      currentSOAPNote.current = null;
      lastNoteUpdateTime.current = Date.now();
      audioChunksRef.current = [];
      setRecordingTime(0);
      
      // Start timer for recording duration
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
      // Create and start MediaRecorder
      const mediaRecorder = new MediaRecorder(streamRef.current);
      mediaRecorderRef.current = mediaRecorder;
      
      // Collect audio data
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      // Start collecting 3-second chunks of audio for processing
      mediaRecorder.start(3000); 
      
      // Set up interval to process audio chunks
      processingIntervalRef.current = setInterval(() => {
        processAudioChunks();
      }, 3000);

    } catch (err) {
      console.error('Error starting recording:', err);
      onError('Failed to start recording. Please try again.');
    }
  };

  const processAudioChunks = async () => {
    if (audioChunksRef.current.length === 0) return;
    
    try {
      // Create a blob from the audio chunks
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
      audioChunksRef.current = []; // Clear the chunks
      
      // Send to the API for transcription
      const response = await fetch('/api/audio', {
        method: 'POST',
        body: audioBlob
      });
      
      if (!response.ok) {
        throw new Error(`Transcription error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Process the transcription
      if (data.results && data.results.channels && data.results.channels[0]) {
        const transcript = data.results.channels[0].alternatives[0]?.transcript || '';
        
        if (transcript.trim()) {
          onTranscriptUpdate(transcript);
          
          // Add to pending transcript
          pendingTranscript.current += ' ' + transcript;
          
          // If it's been 10s since last update, send to SOAP API
          const shouldUpdate = (Date.now() - lastNoteUpdateTime.current > 10000);
          
          if (shouldUpdate && pendingTranscript.current.trim()) {
            updateSOAPNote();
          }
        }
      }
    } catch (err) {
      console.error('Error processing audio:', err);
    }
  };

  const stopRecording = () => {
    // Stop the timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // Stop the processing interval
    if (processingIntervalRef.current) {
      clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    }

    // Stop MediaRecorder if it's running
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    // Process any remaining audio chunks
    if (audioChunksRef.current.length > 0) {
      processAudioChunks();
    }

    // If there's any pending transcript, send a final update
    if (pendingTranscript.current.trim()) {
      updateSOAPNote();
    }
  };

  const updateSOAPNote = async () => {
    if (!pendingTranscript.current.trim()) return;
    
    try {
      onProcessingChange(true);
      
      const payload = {
        transcript: pendingTranscript.current.trim(),
        previous_note: currentSOAPNote.current
      };
      
      // Reset pending transcript after sending
      pendingTranscript.current = '';
      lastNoteUpdateTime.current = Date.now();
      
      const eventSource = new EventSource(`/api/soap?data=${encodeURIComponent(JSON.stringify(payload))}`);
      
      eventSource.onmessage = (event) => {
        try {
          const updatedNote = JSON.parse(event.data);
          currentSOAPNote.current = updatedNote;
          onSOAPNoteUpdate(updatedNote);
        } catch (err) {
          console.error('Error parsing SSE message:', err);
        }
      };
      
      eventSource.onerror = (err) => {
        console.error('SSE Error:', err);
        eventSource.close();
        onProcessingChange(false);
      };
      
      eventSource.addEventListener('done', () => {
        eventSource.close();
        onProcessingChange(false);
      });
      
    } catch (err) {
      console.error('Error updating SOAP note:', err);
      onError('Failed to update SOAP note. Please try again.');
      onProcessingChange(false);
    }
  };

  // Format seconds to MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-4">
        <button
          onClick={onToggleRecording}
          className={`btn ${isRecording ? 'bg-red-600 hover:bg-red-700' : ''}`}
        >
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>
        
        {isRecording && (
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-red-600 animate-pulse mr-2"></div>
            <span className="font-medium">{formatTime(recordingTime)}</span>
          </div>
        )}
      </div>
      
      <div className="text-sm text-gray-600">
        {isRecording 
          ? 'Recording in progress. Speak clearly and the transcript will appear below.' 
          : 'Click "Start Recording" to begin capturing audio and generating a SOAP note.'}
      </div>
    </div>
  );
}
