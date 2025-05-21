'use client';

import React, { useEffect, useRef } from 'react';

interface TranscriptDisplayProps {
  transcript: string;
}

export default function TranscriptDisplay({ transcript }: TranscriptDisplayProps) {
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when transcript updates
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  if (!transcript.trim()) {
    return (
      <div className="text-gray-500 italic">
        No transcript available. Start recording to see the conversation.
      </div>
    );
  }

  return (
    <div 
      ref={transcriptRef}
      className="max-h-[400px] overflow-y-auto p-3 bg-gray-50 rounded-md border border-gray-200 whitespace-pre-wrap"
    >
      {transcript}
    </div>
  );
}
