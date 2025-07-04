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

// Size of audio chunks to send (in milliseconds)
const CHUNK_SIZE = 3000;

export default function AudioRecorder({
  isRecording,
  onToggleRecording,
  onTranscriptUpdate,
  onSOAPNoteUpdate,
  onError,
  onProcessingChange,
}: AudioRecorderProps) {
  // Refs for audio handling
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // State management
  const micAccessGranted = useRef(false);
  const lastNoteUpdateTime = useRef<number>(0);
  const pendingTranscript = useRef<string>('');
  const currentSOAPNote = useRef<SOAPNoteType | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const recordingStartTime = useRef<number>(0);
  
  // UI state
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
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      
      mediaStreamRef.current = stream;
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
        subjective: "[Recording in progress...]",
        objective: "[Recording in progress...]",
        assessment: "[Recording in progress...]",
        plan: "[Recording in progress...]",
        diff: ["Initial note"]
      });
      
      lastNoteUpdateTime.current = Date.now();
      audioBufferRef.current = [];
      setRecordingTime(0);
      recordingStartTime.current = Date.now();
      
      // If we don't have microphone access yet, request it
      if (!micAccessGranted.current) {
        const stream = await requestMicrophoneAccess();
        if (!stream) return;
      }

      // Start timer for recording duration
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
      // Set up WebRTC audio processing
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const audioContext = audioContextRef.current;
      
      // Create microphone source
      microphoneRef.current = audioContext.createMediaStreamSource(mediaStreamRef.current!);
      
      // Create processor node to handle audio data
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      // Set up processing function to collect audio data
      let chunkStartTime = Date.now();
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const audioData = new Float32Array(inputData.length);
        audioData.set(inputData);
        
        // Add to buffer
        audioBufferRef.current.push(audioData);
        
        // Check if it's time to send a chunk
        const now = Date.now();
        if (now - chunkStartTime >= CHUNK_SIZE) {
          // Send audio chunk for processing
          processAudioBuffer();
          chunkStartTime = now;
        }
      };
      
      // Connect nodes: microphone -> processor -> destination
      microphoneRef.current.connect(processor);
      processor.connect(audioContext.destination);
      
      console.log('Recording started with WebRTC audio processing');
      
    } catch (err) {
      console.error('Error starting recording:', err);
      onError('Failed to start recording. Please try again.');
    }
  };

  const processAudioBuffer = async () => {
    if (audioBufferRef.current.length === 0) return;
    
    try {
      // Combine all the buffer chunks
      const combinedLength = audioBufferRef.current.reduce((acc, buffer) => acc + buffer.length, 0);
      const combinedBuffer = new Float32Array(combinedLength);
      
      let offset = 0;
      for (const buffer of audioBufferRef.current) {
        combinedBuffer.set(buffer, offset);
        offset += buffer.length;
      }
      
      // Clear buffer after processing
      audioBufferRef.current = [];
      
      // Convert Float32Array to 16-bit PCM WAV
      const wavBuffer = convertToWav(combinedBuffer, audioContextRef.current!.sampleRate);
      
      // Create a Blob from the WAV buffer
      const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      
      console.log(`Processing audio chunk of size: ${Math.round(audioBlob.size / 1024)} KB`);
      
      // Send to server for transcription
      await sendAudioForTranscription(audioBlob);
      
    } catch (err) {
      console.error('Error processing audio buffer:', err);
    }
  };
  
  const convertToWav = (audioBuffer: Float32Array, sampleRate: number): ArrayBuffer => {
    // WAV file header format
    const createWavHeader = (dataLength: number) => {
      const buffer = new ArrayBuffer(44);
      const view = new DataView(buffer);
      
      // RIFF identifier
      writeString(view, 0, 'RIFF');
      // File length
      view.setUint32(4, 36 + dataLength, true);
      // RIFF type
      writeString(view, 8, 'WAVE');
      // Format chunk identifier
      writeString(view, 12, 'fmt ');
      // Format chunk length
      view.setUint32(16, 16, true);
      // Sample format (1 is PCM)
      view.setUint16(20, 1, true);
      // Channel count
      view.setUint16(22, 1, true);
      // Sample rate
      view.setUint32(24, sampleRate, true);
      // Byte rate (sample rate * block align)
      view.setUint32(28, sampleRate * 2, true);
      // Block align (channel count * bytes per sample)
      view.setUint16(32, 2, true);
      // Bits per sample
      view.setUint16(34, 16, true);
      // Data chunk identifier
      writeString(view, 36, 'data');
      // Data chunk length
      view.setUint32(40, dataLength, true);
      
      return buffer;
    };
    
    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    // Convert Float32Array to Int16Array
    const samples = new Int16Array(audioBuffer.length);
    for (let i = 0; i < audioBuffer.length; i++) {
      // Convert float to int (with clipping)
      const s = Math.max(-1, Math.min(1, audioBuffer[i]));
      samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // Create the WAV file
    const dataLength = samples.length * 2; // 2 bytes per sample
    const headerBuffer = createWavHeader(dataLength);
    const wavBuffer = new Uint8Array(headerBuffer.byteLength + dataLength);
    
    // Combine header and samples
    wavBuffer.set(new Uint8Array(headerBuffer), 0);
    wavBuffer.set(new Uint8Array(samples.buffer), headerBuffer.byteLength);
    
    return wavBuffer.buffer;
  };

  const sendAudioForTranscription = async (audioBlob: Blob) => {
    try {
      // Display indicator to the user
      onError('Processing audio...'); // This is just a status, not an error
      
      const response = await fetch('/api/audio', {
        method: 'POST',
        body: audioBlob,
        headers: {
          'Content-Type': 'audio/wav',
        }
      });
      
      // Log the raw response for debugging
      console.log('API response status:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error response:', errorText);
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Transcription response:', data);
      
      if (data.transcript) {
        // Clear any error messages
        onError(null);
        
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
      } else if (data.error) {
        // Show the specific error from the API
        console.warn('API error:', data.error);
        onError(`Transcription error: ${data.error}`);
      } else {
        console.warn('No transcript in response - continuing recording');
        onError('No transcript detected. Please speak clearly or check your microphone.');
      }
    } catch (err) {
      console.error('Error sending audio for transcription:', err);
      onError(`Failed to process audio: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const stopRecording = () => {
    // Clear timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // Process any remaining audio
    processAudioBuffer();
    
    // Stop WebRTC audio processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    if (microphoneRef.current) {
      microphoneRef.current.disconnect();
      microphoneRef.current = null;
    }
    
    // Close AudioContext
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      // Just suspend, don't close (so we can reuse it)
      audioContextRef.current.suspend();
    }
    
    // Stop all tracks in the media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    // Wait a short time to ensure the last chunk is processed
    setTimeout(() => {
      // Generate final SOAP note with all collected transcripts
      if (pendingTranscript.current.trim()) {
        console.log('Generating SOAP note from real transcript data');
        updateSOAPNote();
      } else if (liveTranscript.trim().length === 0) {
        // Only use mock data if we have no real transcript at all
        console.log('No transcript collected, using mock data for demonstration');
        useMockTranscript();
      } else {
        // We have transcript data but no remaining audio chunks
        console.log('Using existing transcript data for SOAP note');
        updateSOAPNote();
      }
    }, 1000);
    
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
  
  // For demonstration purposes - used as fallback when real audio fails
  const useMockTranscript = () => {
    console.log('Using mock transcript data as fallback');
    onError('Using demo data as your audio could not be processed. Check API keys and microphone permissions.');
    
    // Provide mock transcript for demonstration
    const mockTranscripts = 
      "The patient is a 45-year-old male presenting with chest pain for the past two days. " +
      "He describes it as pressure-like, rates it 6 out of 10 in severity. " + 
      "Pain worsens with exertion and improves with rest. " +
      "Denies radiation to jaw or arm. Reports mild shortness of breath. " +
      "No history of heart disease, but has hypertension controlled with lisinopril. " +
      "BP is 130/85, heart rate 75, temperature 98.6. Lungs are clear.";
    
    // Set the mock transcript
    pendingTranscript.current = mockTranscripts;
    setLiveTranscript(mockTranscripts);
    onTranscriptUpdate(mockTranscripts);
    
    // Generate SOAP note from the mock transcript
    updateSOAPNote();
  };
  
  // Helper function for SOAP note generation as a fallback
  const useMockSOAPNote = (transcript = '') => {
    console.log('Using mock SOAP note data as fallback');
    onError('Using demo SOAP note as your data could not be processed. Check API keys and permissions.');
    
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
    onProcessingChange(false);
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
