# Voice / Text-to-Speech

Generate speech from text using ElevenLabs API.

## Setup

API key in `.env`:
```
ELEVENLABS_API_KEY=sk_...
```

## Generate Speech

```bash
source .env
curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello, this is Ekus speaking.",
    "model_id": "eleven_multilingual_v2",
    "voice_settings": {
      "stability": 0.5,
      "similarity_boost": 0.75
    }
  }' \
  --output /tmp/speech.mp3
```

## Speed Up Audio (1.5x)

```bash
ffmpeg -i /tmp/speech.mp3 -filter:a "atempo=1.5" -y /tmp/speech-fast.mp3
```

## Voice IDs

List available voices:
```bash
curl -s "https://api.elevenlabs.io/v1/voices" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" | python3 -c "import json,sys;[print(v['voice_id'],v['name']) for v in json.load(sys.stdin)['voices']]"
```

## Best Practices

- Use `eleven_multilingual_v2` model for Portuguese
- Keep text under 5000 chars per request
- Speed up to 1.5x for conversational use
- Save to /tmp/ for temporary audio, project folder for permanent
