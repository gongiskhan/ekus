"""Faster-whisper transcription with lazy model loading and prompt conditioning."""

import asyncio
import logging
import time
from pathlib import Path
from typing import Optional

from . import db

log = logging.getLogger(__name__)

_model = None


def _get_model():
    """Lazy-load the WhisperModel on first use."""
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        print("[WHISPER] Loading faster-whisper large-v3 (int8, cpu)...", flush=True)
        t0 = time.monotonic()
        _model = WhisperModel(
            "large-v3", device="cpu", compute_type="int8", cpu_threads=4
        )
        print(f"[WHISPER] Model loaded in {time.monotonic()-t0:.1f}s", flush=True)
    return _model


def warm_up():
    """Pre-load the model. Call from startup to avoid first-request delay."""
    _get_model()


def _build_initial_prompt(language: str = "") -> str:
    """Build a conditioning prompt from vocabulary + top corrections."""
    vocab = db.list_vocabulary(language=language)
    terms = [v["term"] for v in vocab]
    corrections = db.get_top_corrections(language=language, limit=50)
    corr_pairs = [f"{c['original']} → {c['corrected']}" for c in corrections]

    if language == "pt":
        parts = ["Transcrição em português de Portugal."]
        if terms:
            parts.append(f"Nomes e termos: {', '.join(terms)}.")
        if corr_pairs:
            parts.append(f"Correções conhecidas: {'; '.join(corr_pairs)}.")
    else:
        parts = ["Transcription in English."]
        if terms:
            parts.append(f"Names and terms: {', '.join(terms)}.")
        if corr_pairs:
            parts.append(f"Known corrections: {'; '.join(corr_pairs)}.")

    return " ".join(parts)


def _transcribe_sync(
    audio_path: str, language: str = "", initial_prompt: Optional[str] = None
) -> dict:
    """Run transcription (blocking). Call via asyncio.to_thread."""
    model = _get_model()
    if initial_prompt is None:
        initial_prompt = _build_initial_prompt(language)

    kwargs = {
        "beam_size": 5,
        "vad_filter": False,
    }
    if initial_prompt:
        kwargs["initial_prompt"] = initial_prompt
    if language:
        kwargs["language"] = language

    t0 = time.monotonic()
    segments, info = model.transcribe(audio_path, **kwargs)
    text_parts = [seg.text for seg in segments]
    duration = time.monotonic() - t0

    text = "".join(text_parts).strip()
    return {
        "text": text,
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration_seconds": round(info.duration, 2),
        "transcription_time": round(duration, 2),
    }


def _transcribe_fast_sync(
    audio_path: str, language: str = "", initial_prompt: Optional[str] = None
) -> dict:
    """Fast transcription with beam_size=1 for partials."""
    model = _get_model()
    if initial_prompt is None:
        initial_prompt = _build_initial_prompt(language)

    kwargs = {
        "beam_size": 1,
        "vad_filter": False,
    }
    if initial_prompt:
        kwargs["initial_prompt"] = initial_prompt
    if language:
        kwargs["language"] = language

    t0 = time.monotonic()
    segments, info = model.transcribe(audio_path, **kwargs)
    text_parts = [seg.text for seg in segments]
    duration = time.monotonic() - t0

    text = "".join(text_parts).strip()
    return {
        "text": text,
        "language": info.language,
        "transcription_time": round(duration, 2),
    }


async def transcribe(
    audio_path: str | Path, language: str = "", initial_prompt: Optional[str] = None
) -> dict:
    """Async wrapper — runs transcription in a thread."""
    return await asyncio.to_thread(
        _transcribe_sync, str(audio_path), language, initial_prompt
    )


async def transcribe_fast(
    audio_path: str | Path, language: str = "", initial_prompt: Optional[str] = None
) -> dict:
    """Async wrapper — fast transcription for partials."""
    return await asyncio.to_thread(
        _transcribe_fast_sync, str(audio_path), language, initial_prompt
    )
