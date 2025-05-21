'use client';

import { useState } from 'react';
import { SOAPNoteType } from '../types';

interface SOAPNoteProps {
  note: SOAPNoteType | null;
  isLoading: boolean;
}

export default function SOAPNote({ note, isLoading }: SOAPNoteProps) {
  const [editMode, setEditMode] = useState(false);
  const [editedNote, setEditedNote] = useState<SOAPNoteType | null>(note);

  // Update edited note when the incoming note changes
  if (note !== null && JSON.stringify(note) !== JSON.stringify(editedNote)) {
    setEditedNote(note);
  }

  const handleEdit = () => {
    setEditMode(true);
  };

  const handleSave = () => {
    setEditMode(false);
    // In a real app, you'd probably want to propagate these changes up
    // to the parent component
  };

  const handleCancel = () => {
    setEditMode(false);
    setEditedNote(note);
  };

  const handleInputChange = (section: keyof SOAPNoteType, value: string) => {
    if (!editedNote) return;
    
    if (section === 'metadata') return; // Handle metadata separately if needed
    
    setEditedNote({
      ...editedNote,
      [section]: value
    });
  };

  if (isLoading && !note) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        <div className="h-4 bg-gray-200 rounded w-5/6"></div>
        <div className="h-4 bg-gray-200 rounded w-2/3"></div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="text-gray-500 italic">
        No SOAP note generated yet. Start recording to create one.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h3 className="font-semibold">Metadata</h3>
        {!editMode && (
          <button 
            onClick={handleEdit}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Edit Note
          </button>
        )}
        {editMode && (
          <div className="space-x-2">
            <button 
              onClick={handleSave}
              className="text-sm text-green-600 hover:text-green-800"
            >
              Save
            </button>
            <button 
              onClick={handleCancel}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><span className="font-medium">Patient:</span> {note.metadata.patient_name || '[Unknown]'}</div>
        <div><span className="font-medium">Clinician:</span> {note.metadata.clinician_name || '[Unknown]'}</div>
        <div><span className="font-medium">Date/Time:</span> {new Date(note.metadata.visit_datetime).toLocaleString()}</div>
        <div><span className="font-medium">Chief Complaint:</span> {note.metadata.chief_complaint || '[Not mentioned]'}</div>
        <div className="col-span-2">
          <span className="font-medium">Medications:</span> {
            note.metadata.medications_list.length > 0 
              ? note.metadata.medications_list.join(', ') 
              : '[None mentioned]'
          }
        </div>
      </div>

      {['subjective', 'objective', 'assessment', 'plan'].map((section) => (
        <div key={section} className="space-y-2">
          <h3 className="font-semibold capitalize">{section}</h3>
          {editMode ? (
            <textarea
              value={editedNote?.[section as keyof SOAPNoteType] as string}
              onChange={(e) => handleInputChange(section as keyof SOAPNoteType, e.target.value)}
              className="w-full p-2 border rounded-md min-h-[100px]"
            />
          ) : (
            <div className="whitespace-pre-wrap">{note[section as keyof SOAPNoteType] as string}</div>
          )}
        </div>
      ))}

      {note.diff && note.diff.length > 0 && (
        <div className="mt-4 p-3 bg-yellow-50 rounded-md">
          <h3 className="font-semibold text-sm mb-1">Recent Updates:</h3>
          <ul className="text-sm list-disc pl-4">
            {note.diff.map((item, index) => (
              <li key={index} className="text-gray-700">{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
