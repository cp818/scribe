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

export default function SimpleAudioRecorder({
  isRecording,
  onToggleRecording,
  onTranscriptUpdate,
  onSOAPNoteUpdate,
  onError,
  onProcessingChange,
}: AudioRecorderProps) {
  // Media recorder state
  const [patientName, setPatientName] = useState('');
  const [clinicianName, setClinicianName] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [medications, setMedications] = useState('');
  
  // Recording state
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [transcript, setTranscript] = useState('');

  // Use effect to control recording state
  useEffect(() => {
    if (isRecording) {
      startRecording();
    } else {
      stopRecording();
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);

  const startRecording = async () => {
    try {
      onError(null);
      setTranscript('');
      onTranscriptUpdate('');
      
      // Reset recording state
      audioChunksRef.current = [];
      setRecordingTime(0);
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Create and start MediaRecorder
      let options = {};
      
      // Try different formats in order of preference
      const preferredFormats = ['audio/wav', 'audio/webm', 'audio/webm;codecs=opus'];
      
      for (const format of preferredFormats) {
        if (MediaRecorder.isTypeSupported(format)) {
          options = { mimeType: format };
          console.log(`Using audio format: ${format}`);
          break;
        }
      }
      
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      
      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      // Collect audio data
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Handle recording stop
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        await processAudioChunk(audioBlob);
      };

      // Start recording with 1 second chunks
      mediaRecorder.start(1000);
      console.log('Recording started');
      
      // Initial empty SOAP note
      onSOAPNoteUpdate({
        metadata: {
          patient_name: patientName || null,
          clinician_name: clinicianName || null,
          visit_datetime: new Date().toISOString(),
          chief_complaint: chiefComplaint || null,
          medications_list: medications ? medications.split(',').map(med => med.trim()) : []
        },
        subjective: "[Recording in progress...]",
        objective: "[Recording in progress...]",
        assessment: "[Recording in progress...]",
        plan: "[Recording in progress...]",
        diff: ["Initial note"]
      });
      
    } catch (err) {
      console.error('Error starting recording:', err);
      onError('Failed to start recording. Please check microphone permissions.');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      console.log('Recording stopped');
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const processAudioChunk = async (audioBlob: Blob) => {
    try {
      onProcessingChange(true);
      console.log(`Processing audio chunk: ${Math.round(audioBlob.size / 1024)} KB`);
      console.log('Audio MIME type:', audioBlob.type);

      // Send to server for transcription
      const response = await fetch('/api/audio', {
        method: 'POST',
        body: audioBlob,
        headers: {
          'Content-Type': audioBlob.type || 'audio/webm',
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Transcription API error: ${response.status} - ${errorText}`);
      }

      let data;
      try {
        data = await response.json();
        console.log('Transcription response:', data);
      } catch (e) {
        console.error('Error parsing JSON response:', e);
        throw new Error('Invalid response from transcription service');
      }

      // Extract transcript from Deepgram response format with safe access
      let newTranscript = '';
      try {
        if (data && data.results && 
            data.results.channels && 
            data.results.channels[0] && 
            data.results.channels[0].alternatives && 
            data.results.channels[0].alternatives[0] && 
            data.results.channels[0].alternatives[0].transcript) {
          newTranscript = data.results.channels[0].alternatives[0].transcript;
        } else if (data && data.transcript) {
          newTranscript = data.transcript;
        } else {
          console.warn('Unexpected response format:', data);
          newTranscript = 'Transcript could not be processed properly.';
        }
      } catch (e) {
        console.error('Error extracting transcript:', e);
        newTranscript = 'Error processing audio transcript.';
      }

      if (newTranscript) {
        setTranscript(newTranscript);
        onTranscriptUpdate(newTranscript);
        await generateSOAPNote(newTranscript);
      } else {
        console.warn('No transcript in response');
        onError('No speech detected in the recording. Please try again.');
      }
    } catch (err) {
      console.error('Error processing audio:', err);
      onError(`Failed to process audio: ${err instanceof Error ? err.message : String(err)}`);
      // Fall back to mock data if available
      console.log('Using mock data as fallback');
      useMockData();
    } finally {
      onProcessingChange(false);
    }
  };

  const generateSOAPNote = async (transcript: string) => {
    try {
      onProcessingChange(true);
      
      const payload = {
        transcript,
        metadata: {
          patient_name: patientName || null,
          clinician_name: clinicianName || null,
          visit_datetime: new Date().toISOString(),
          chief_complaint: chiefComplaint || null,
          medications_list: medications ? medications.split(',').map(med => med.trim()) : []
        }
      };
      
      console.log('Sending data to SOAP API:', payload);
      
      try {
        const response = await fetch('/api/soap', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`SOAP API error: ${response.status}`);
        }

        const soapNote = await response.json();
        
        // Validate the response structure to prevent client-side exceptions
        if (soapNote && typeof soapNote === 'object') {
          // Ensure the SOAP note has all required fields
          const validatedNote = {
            metadata: {
              patient_name: soapNote.metadata?.patient_name || null,
              clinician_name: soapNote.metadata?.clinician_name || null,
              visit_datetime: soapNote.metadata?.visit_datetime || new Date().toISOString(),
              chief_complaint: soapNote.metadata?.chief_complaint || null,
              medications_list: Array.isArray(soapNote.metadata?.medications_list) ? 
                               soapNote.metadata.medications_list : []
            },
            subjective: soapNote.subjective || '[No subjective information]',
            objective: soapNote.objective || '[No objective information]',
            assessment: soapNote.assessment || '[No assessment information]',
            plan: soapNote.plan || '[No plan information]',
            diff: Array.isArray(soapNote.diff) ? soapNote.diff : ['Note generated']
          };
          
          console.log('SOAP note generated and validated:', validatedNote);
          onSOAPNoteUpdate(validatedNote);
        } else {
          throw new Error('Invalid SOAP note structure received');
        }
      } catch (error) {
        console.error('Error in SOAP note fetch:', error);
        throw error;
      }
    } catch (err) {
      console.error('Error generating SOAP note:', err);
      onError(`Failed to generate SOAP note: ${err instanceof Error ? err.message : String(err)}`);
      // Use mock data as fallback
      useMockData();
    } finally {
      onProcessingChange(false);
    }
  };

  const useMockData = () => {
    const mockNote: SOAPNoteType = {
      metadata: {
        patient_name: patientName || null,
        clinician_name: clinicianName || null,
        visit_datetime: new Date().toISOString(),
        chief_complaint: chiefComplaint || null,
        medications_list: medications ? medications.split(',').map(med => med.trim()) : []
      },
      subjective: "Patient reports chest pain for the past two days. Describes the pain as pressure-like and rates it 6/10 in severity. Pain is worse with exertion and improves with rest.",
      objective: "Vitals: BP 130/85, HR 75 bpm, Temp 98.6°F. Lungs clear to auscultation. Regular heart rate and rhythm.",
      assessment: "1. Chest pain, likely musculoskeletal in origin.\n2. Hypertension, well-controlled.",
      plan: "1. ECG ordered to rule out cardiac causes.\n2. Continue current medications.\n3. Follow up in 1 week if symptoms persist.",
      diff: ["Using mock data for demonstration"]
    };
    
    // Use mock transcript
    const mockTranscript = "The patient is a 45-year-old male presenting with chest pain for the past two days. " +
      "He describes it as pressure-like, rates it 6 out of 10 in severity. " + 
      "Pain worsens with exertion and improves with rest. " +
      "No history of heart disease, but has hypertension controlled with lisinopril.";
    
    setTranscript(mockTranscript);
    onTranscriptUpdate(mockTranscript);
    onSOAPNoteUpdate(mockNote);
  };

  // Format seconds to MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Patient and Clinician information form */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="patientName" className="block text-sm font-medium text-gray-700">
            Patient Name
          </label>
          <input
            type="text"
            id="patientName"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            placeholder="Enter patient name"
            disabled={isRecording}
          />
        </div>
        
        <div>
          <label htmlFor="clinicianName" className="block text-sm font-medium text-gray-700">
            Clinician Name
          </label>
          <input
            type="text"
            id="clinicianName"
            value={clinicianName}
            onChange={(e) => setClinicianName(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            placeholder="Enter clinician name"
            disabled={isRecording}
          />
        </div>
        
        <div>
          <label htmlFor="chiefComplaint" className="block text-sm font-medium text-gray-700">
            Chief Complaint
          </label>
          <input
            type="text"
            id="chiefComplaint"
            value={chiefComplaint}
            onChange={(e) => setChiefComplaint(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            placeholder="E.g., Chest pain, Fever, etc."
            disabled={isRecording}
          />
        </div>
        
        <div>
          <label htmlFor="medications" className="block text-sm font-medium text-gray-700">
            Medications (comma separated)
          </label>
          <input
            type="text"
            id="medications"
            value={medications}
            onChange={(e) => setMedications(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            placeholder="E.g., Lisinopril, Aspirin, etc."
            disabled={isRecording}
          />
        </div>
      </div>
      
      {/* Recording controls */}
      <div className="flex items-center space-x-4">
        <button
          onClick={onToggleRecording}
          className={`px-4 py-2 rounded-md font-medium text-white ${
            isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
          }`}
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
          : 'Enter patient information above, then click "Start Recording" to begin capturing audio.'}
      </div>
      
      {/* Live transcript preview */}
      {transcript && (
        <div className="mt-4 p-3 bg-gray-50 rounded-md">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Current Transcript:</h3>
          <p className="text-sm text-gray-600">{transcript}</p>
        </div>
      )}
    </div>
  );
}
