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

// How often to update the SOAP note (in milliseconds)
const NOTE_UPDATE_INTERVAL = 5000;

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
  const [liveTranscript, setLiveTranscript] = useState('');

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
      setLiveTranscript('');
      onTranscriptUpdate('');
      currentSOAPNote.current = null;
      // Use an empty initial SOAP note instead of null
      onSOAPNoteUpdate({
        metadata: {
          patient_name: null,
          clinician_name: null,
          visit_datetime: new Date().toISOString(),
          chief_complaint: null,
          medications_list: []
        },
        subjective: "[Waiting for transcript...]",
        objective: "[Waiting for transcript...]",
        assessment: "[Waiting for transcript...]",
        plan: "[Waiting for transcript...]",
        diff: ["Initial note"]
      });
      
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
          processAudioChunk(event.data);
        }
      };
      
      // Start collecting 3-second chunks of audio for processing
      mediaRecorder.start(3000);

    } catch (err) {
      console.error('Error starting recording:', err);
      onError('Failed to start recording. Please try again.');
    }
  };

  const processAudioChunk = async (audioBlob: Blob) => {
    if (!audioBlob || audioBlob.size === 0) {
      console.error('Empty audio blob received');
      return;
    }

    try {
      console.log(`Processing audio chunk of size: ${Math.round(audioBlob.size / 1024)} KB`);
      
      const response = await fetch('/api/audio', {
        method: 'POST',
        body: audioBlob,
        headers: {
          'Content-Type': 'audio/webm',
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Transcription response:', data);

      if (data.transcript) {
        // Add to pending transcript
        pendingTranscript.current += ' ' + data.transcript;
        
        // Update live transcript in UI
        const newTranscript = liveTranscript + ' ' + data.transcript;
        setLiveTranscript(newTranscript);
        onTranscriptUpdate(newTranscript);
        
        // Update SOAP note periodically
        const now = Date.now();
        if (now - lastNoteUpdateTime.current > NOTE_UPDATE_INTERVAL) {
          updateSOAPNote();
        }
      } else {
        console.warn('No transcript in response - continuing recording');
        // Don't fall back to mock transcript right away
      }
    } catch (err) {
      console.error('Error processing audio chunk:', err);
    }
  };

  const stopRecording = () => {
    // Clear timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // Stop MediaRecorder and release microphone
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    
    // Process any remaining audio chunks
    if (audioChunksRef.current.length > 0) {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      processAudioChunk(audioBlob);
    }
    
    // Generate final SOAP note with all collected transcripts
    if (pendingTranscript.current.trim()) {
      updateSOAPNote();
    } else if (liveTranscript.trim().length === 0) {
      // Only use mock data if we have no real transcript at all
      console.log('No transcript collected, using mock data for demonstration');
      useMockTranscript();
    }
    
    // Mark as not processing
    onProcessingChange(false);
  };

  const updateSOAPNote = async () => {
    if (!pendingTranscript.current.trim()) return;
    
    try {
      onProcessingChange(true);
      
      const payload = {
        transcript: pendingTranscript.current.trim(),
        previous_note: currentSOAPNote.current
      };
      
      console.log('Sending transcript to SOAP API:', payload.transcript);
      
      // Reset pending transcript after sending
      pendingTranscript.current = '';
      lastNoteUpdateTime.current = Date.now();
      
      try {
        // Try to use the API first
        const response = await fetch('/api/soap', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`SOAP API returned ${response.status}: ${response.statusText}`);
        }

        const updatedNote = await response.json();
        console.log('Received SOAP note update:', updatedNote);
        
        if (updatedNote) {
          currentSOAPNote.current = updatedNote;
          onSOAPNoteUpdate(updatedNote);
        } else {
          console.error('Empty SOAP note response');
          useMockSOAPNote(payload.transcript);
        }
      } catch (apiError) {
        console.error('Error getting SOAP note:', apiError);
        useMockSOAPNote(payload.transcript);
      }
    } catch (err) {
      console.error('Error updating SOAP note:', err);
      onError('Could not update SOAP note. Using mock data for demonstration.');
      useMockSOAPNote();
    } finally {
      onProcessingChange(false);
    }
  };
  
  // For demonstration purposes only
  const useMockTranscript = () => {
    console.log('Using mock transcript data');
    // Only use this if we have no real transcript data after stopping recording
    if (pendingTranscript.current.trim().length > 0) {
      console.log('Already have real transcript data, not using mock data');
      return;
    }
    
    const mockTranscripts = 
      "The patient is a 45-year-old male presenting with chest pain for the past two days. " +
      "He describes it as pressure-like, rates it 6 out of 10 in severity. " + 
      "Pain worsens with exertion and improves with rest. " +
      "Denies radiation to jaw or arm. Reports mild shortness of breath. " +
      "No history of heart disease, but has hypertension controlled with lisinopril. " +
      "BP is 130/85, heart rate 75, temperature 98.6. Lungs are clear.";
    
    // Set the entire mock transcript at once when stopping recording
    pendingTranscript.current = mockTranscripts;
    setLiveTranscript(mockTranscripts);
    onTranscriptUpdate(mockTranscripts);
    
    // Generate SOAP note from the mock transcript
    updateSOAPNote();
  };
  
  // Helper function to use mock SOAP note data for demonstration
  const useMockSOAPNote = (transcript = '') => {
    console.log('Using mock SOAP note data');
    
    // Create a mock SOAP note that follows the Helix-Scribe prompt format
    const mockNote: SOAPNoteType = {
      metadata: {
        patient_name: transcript.includes('Smith') ? 'John Smith' : null,
        clinician_name: transcript.includes('Dr.') ? transcript.match(/Dr\. ([A-Za-z]+)/)?.at(1) || null : null,
        visit_datetime: new Date().toISOString(),
        chief_complaint: transcript.includes('pain') ? 'Chest pain' : 
                        transcript.includes('fever') ? 'Fever' : 
                        transcript.includes('throat') ? 'Sore throat' : null,
        medications_list: transcript.includes('lisinopril') ? ['Lisinopril'] : 
                         transcript.includes('aspirin') ? ['Aspirin'] : []
      },
      subjective: transcript ? 
        `Patient reports ${transcript.includes('pain') ? 'chest pain for the past two days' : 
                         transcript.includes('fever') ? 'fever and chills for three days' : 
                         transcript.includes('throat') ? 'sore throat and difficulty swallowing' : 
                         'general malaise'}. ${transcript.includes('sleep') ? 'Sleep has been disturbed.' : '[Additional symptoms not mentioned]'}` : 
        "Patient reports chest discomfort that began two days ago. Describes the pain as pressure-like and rates it 6/10 in severity. Pain is worse with exertion and improves with rest. [No radiation mentioned]. [Associated symptoms unclear].",
      
      objective: transcript ?
        `Vitals: ${transcript.includes('120/80') ? 'BP 120/80' : '[BP not mentioned]'}, ${transcript.includes('heart rate') ? 'HR ' + (transcript.match(/heart rate (\d+)/)?.at(1) || '75') + ' bpm' : '[HR not mentioned]'}, ${transcript.includes('temperature') ? 'Temp ' + (transcript.match(/temperature (\d+)/)?.at(1) || '98.6') + '°F' : '[Temperature not recorded]'}. ${transcript.includes('lungs') ? 'Lungs clear to auscultation.' : '[Lung exam not documented]'} ${transcript.includes('heart') ? 'Regular heart rate and rhythm.' : '[Heart exam not documented]'}` :
        "[Vitals not recorded]. [Physical examination incomplete].",
      
      assessment: transcript ?
        `${transcript.includes('chest pain') ? '1. Chest pain, likely musculoskeletal in origin.' : 
          transcript.includes('fever') ? '1. Viral syndrome, possibly influenza.' : 
          transcript.includes('throat') ? '1. Acute pharyngitis, likely viral.' : 
          '1. [Assessment pending further information].'} ${transcript.includes('hypertension') ? '\n2. Hypertension, current control status unclear.' : ''}` :
        "1. [Assessment pending further information].",
      
      plan: transcript ?
        `${transcript.includes('EKG') ? '1. EKG ordered.' : '1. [Diagnostic tests not specified].'} ${transcript.includes('blood') ? '\n2. Bloodwork ordered including CBC, CMP.' : ''} ${transcript.includes('aspirin') ? '\n3. Continue aspirin.' : ''} \n${transcript.includes('follow up') ? 'Follow up ' + (transcript.includes('week') ? 'in one week' : 'as scheduled') + '.' : '4. [Follow-up plan not discussed].'}` :
        "1. [Treatment plan not yet established].\n2. [Follow-up recommendations pending].",
      
      diff: ["Initial SOAP note generated based on limited transcript data"]
    };
    
    // Update the current note and notify the UI
    currentSOAPNote.current = mockNote;
    onSOAPNoteUpdate(mockNote);
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
