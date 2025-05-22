'use client';

import { useEffect } from 'react';

interface ErrorComponentProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorComponent({
  error,
  reset,
}: ErrorComponentProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-4">
      <div className="card max-w-lg w-full">
        <h2 className="text-xl font-bold text-red-600 mb-4">
          Something went wrong
        </h2>
        <div className="bg-red-50 p-4 rounded-md mb-4">
          <p className="text-sm text-red-800 mb-2">
            {error.message || "An unexpected error occurred"}
          </p>
          {error.stack && (
            <pre className="text-xs text-red-700 bg-red-100 p-2 rounded overflow-auto max-h-[200px]">
              {error.stack}
            </pre>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={reset}
            className="btn bg-blue-600 hover:bg-blue-700 text-white"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.href = '/'}
            className="btn bg-gray-200 hover:bg-gray-300 text-gray-800"
          >
            Go back home
          </button>
        </div>
      </div>
    </div>
  );
}
