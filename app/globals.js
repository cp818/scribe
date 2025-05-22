// Add global error handling to prevent uncaught exceptions from crashing the app
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error('Global error caught:', event.error);
    // Prevent the error from crashing the entire app
    event.preventDefault();
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    // Prevent the rejection from crashing the entire app
    event.preventDefault();
  });
}
