"""FastAPI routes for voice dictation — transcription, corrections, vocabulary, preferences."""

import logging
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from . import db
from .cleanup import cleanup_text
from .pipeline import DictationSession
from .transcriber import transcribe

log = logging.getLogger(__name__)

voice_router = APIRouter()

# Will be set from main.py during startup
VOICE_DIR: Path | None = None


def init_voice_dir(voice_dir: Path) -> None:
    global VOICE_DIR
    VOICE_DIR = voice_dir
    voice_dir.mkdir(parents=True, exist_ok=True)


# ── Request models ───────────────────────────────────────────────────


class CorrectionRequest(BaseModel):
    original: str
    corrected: str
    language: Optional[str] = ""


class CorrectionBatchRequest(BaseModel):
    corrections: list[dict]
    language: Optional[str] = ""


class VocabularyRequest(BaseModel):
    term: str
    language: Optional[str] = ""
    category: Optional[str] = ""


class CleanupRequest(BaseModel):
    text: str
    language: Optional[str] = ""


# ── Transcription ────────────────────────────────────────────────────


@voice_router.post("/transcribe-local")
async def transcribe_local(
    file: UploadFile = File(...),
    language: str = "",
):
    """Transcribe audio locally using faster-whisper."""
    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio file too large (max 25MB)")

    audio_id = uuid4().hex[:8]
    ext = Path(file.filename or "audio.webm").suffix or ".webm"
    audio_path = VOICE_DIR / f"{audio_id}{ext}"
    audio_path.write_bytes(content)

    try:
        result = await transcribe(audio_path, language=language)
    except Exception as e:
        log.error("Transcription failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")

    return {
        "audio_id": audio_id,
        "text": result["text"],
        "language": result.get("language", language),
        "language_probability": result.get("language_probability"),
        "duration_seconds": result.get("duration_seconds"),
        "transcription_time": result.get("transcription_time"),
    }


# ── Corrections ──────────────────────────────────────────────────────


@voice_router.get("/corrections")
async def get_corrections(language: str = "", limit: int = 50, offset: int = 0):
    corrections, total = db.list_corrections(language=language, limit=limit, offset=offset)
    return {"corrections": corrections, "total": total}


@voice_router.post("/corrections")
async def create_correction(body: CorrectionRequest):
    result = db.add_correction(body.original, body.corrected, body.language or "")
    return {"id": result["id"], "frequency": result["frequency"]}


@voice_router.post("/corrections/batch")
async def create_corrections_batch(body: CorrectionBatchRequest):
    result = db.add_corrections_batch(body.corrections, body.language or "")
    return result


@voice_router.delete("/corrections/{correction_id}")
async def remove_correction(correction_id: int):
    if not db.delete_correction(correction_id):
        raise HTTPException(status_code=404, detail="Correction not found")
    return {"ok": True}


# ── Vocabulary ───────────────────────────────────────────────────────


@voice_router.get("/vocabulary")
async def get_vocabulary(language: str = ""):
    terms = db.list_vocabulary(language=language)
    return {"terms": terms}


@voice_router.post("/vocabulary")
async def create_vocabulary(body: VocabularyRequest):
    result = db.add_vocabulary(body.term, body.language or "", body.category or "")
    return {"id": result["id"]}


@voice_router.delete("/vocabulary/{vocab_id}")
async def remove_vocabulary(vocab_id: int):
    if not db.delete_vocabulary(vocab_id):
        raise HTTPException(status_code=404, detail="Vocabulary term not found")
    return {"ok": True}


# ── Preferences ──────────────────────────────────────────────────────


@voice_router.get("/preferences")
async def get_preferences():
    return db.get_preferences()


@voice_router.put("/preferences")
async def update_preferences(request: Request):
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    for key, value in body.items():
        db.set_preference(key, str(value))
    return {"ok": True}


# ── Cleanup ──────────────────────────────────────────────────────────


@voice_router.post("/cleanup")
async def cleanup(body: CleanupRequest):
    """Clean up transcribed text using Claude."""
    language = body.language or ""
    corrections = db.get_top_corrections(language=language, limit=50)
    cleaned = await cleanup_text(body.text, language=language, corrections=corrections)
    return {"cleaned": cleaned}


# ── WebSocket dictation ──────────────────────────────────────────────


@voice_router.websocket("/dictation")
async def dictation_ws(websocket: WebSocket):
    """Streaming dictation over WebSocket.

    Protocol:
    1. Client sends JSON: {"type": "start", "language": "pt", "session_id": "..."}
    2. Client sends binary messages (WebM/Opus audio chunks)
    3. Server sends JSON events: vad_state, partial, final, cleanup, error
    4. Client sends JSON: {"type": "stop"} to end — server flushes and closes
    5. Client can send {"type": "ping"} — server responds {"type": "pong"}
    """
    await websocket.accept()
    print(f"[WS] Dictation connected from {websocket.client}", flush=True)
    session: Optional[DictationSession] = None

    async def send_event(event_type: str, data: dict) -> None:
        """Callback for DictationSession events."""
        try:
            print(f"[WS] Sending event: {event_type} {str(data)[:200]}", flush=True)
            await websocket.send_json({"type": event_type, **data})
        except Exception as e:
            print(f"[WS] Send failed: {e}", flush=True)

    try:
        # Wait for start message
        start_msg = await websocket.receive_json()
        print(f"[WS] Start: {start_msg}", flush=True)
        if start_msg.get("type") != "start":
            await websocket.send_json({"type": "error", "message": "Expected start message"})
            await websocket.close(code=1002)
            return

        language = start_msg.get("language", "")
        session_id = start_msg.get("session_id", "")
        enable_cleanup = start_msg.get("cleanup", True)

        session = DictationSession(
            language=language,
            callback=send_event,
            enable_cleanup=enable_cleanup,
        )
        await session.start()
        print(f"[WS] Session started (lang={language})", flush=True)
        await websocket.send_json({"type": "started", "session_id": session_id})

        # Main receive loop
        chunk_count = 0
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                print(f"[WS] Disconnect after {chunk_count} chunks", flush=True)
                break

            if "bytes" in message and message["bytes"]:
                chunk_count += 1
                if chunk_count <= 3 or chunk_count % 100 == 0:
                    print(f"[WS] Chunk #{chunk_count} ({len(message['bytes'])}b)", flush=True)
                await session.feed_audio(message["bytes"])

            elif "text" in message and message["text"]:
                import json
                try:
                    msg = json.loads(message["text"])
                except (json.JSONDecodeError, TypeError):
                    continue

                msg_type = msg.get("type", "")
                print(f"[WS] Message: {msg_type}", flush=True)

                if msg_type == "stop":
                    print("[WS] Stopping session...", flush=True)
                    cleaned_text = await session.stop()
                    print(f"[WS] Stopped. Text: {str(cleaned_text)[:200]}", flush=True)
                    try:
                        await websocket.send_json({
                            "type": "stopped",
                            "text": cleaned_text or "",
                        })
                    except Exception as e:
                        print(f"[WS] Failed to send stopped event: {e}", flush=True)
                    break

                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        print("[WS] Client disconnected", flush=True)
    except Exception as e:
        print(f"[WS] ERROR: {e}", flush=True)
        import traceback
        traceback.print_exc()
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if session:
            await session.destroy()
        try:
            await websocket.close()
        except Exception:
            pass
