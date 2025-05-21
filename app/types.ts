export interface SOAPNoteType {
  metadata: {
    patient_name: string | null;
    clinician_name: string | null;
    visit_datetime: string;
    chief_complaint: string | null;
    medications_list: string[];
  };
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  diff?: string[];
}

export interface TranscriptChunk {
  type: 'transcript';
  is_final: boolean;
  channel: {
    alternatives: {
      transcript: string;
    }[];
  };
}

export interface SOAPRequestPayload {
  transcript: string;
  previous_note: SOAPNoteType | null;
}
