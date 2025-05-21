#!/bin/bash

# This script safely sets up your environment variables
# It creates/updates your .env.local file without exposing keys

# Create or replace the .env.local file
cat > .env.local << EOL
# Deepgram API key for speech-to-text (add your key, then delete this comment)
DEEPGRAM_API_KEY=

# OpenAI API key for SOAP note generation (add your key, then delete this comment)
OPENAI_API_KEY=
EOL

echo "Created .env.local file. Please edit it to add your API keys."
echo "IMPORTANT: NEVER share your API keys or commit the .env.local file to Git."
echo "After adding your keys, you can run 'npm run dev' to start the development server."
