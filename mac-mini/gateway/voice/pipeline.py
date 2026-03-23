"""DictationSession — orchestrates the streaming dictation pipeline.

Audio flow: WebM/Opus chunks → ffmpeg decode → PCM → VAD → segment assembly → transcription
"""

import asyncio
import io
import logging
import re
import struct
import tempfile
import time
import wave
from pathlib import Path
from typing import Callable, Awaitable, Optional

import numpy as np

from .vad import StreamingVAD, VadState, SAMPLE_RATE, FRAME_SAMPLES
from . import db

log = logging.getLogger(__name__)

# Segment assembly parameters
PRE_ROLL_MS = 200
POST_ROLL_MS = 350
MERGE_GAP_MS = 400
MIN_SEGMENT_MS = 500
SILENCE_END_MS = 600

PRE_ROLL_SAMPLES = int(PRE_ROLL_MS * SAMPLE_RATE / 1000)
POST_ROLL_SAMPLES = int(POST_ROLL_MS * SAMPLE_RATE / 1000)
MERGE_GAP_SAMPLES = int(MERGE_GAP_MS * SAMPLE_RATE / 1000)
MIN_SEGMENT_SAMPLES = int(MIN_SEGMENT_MS * SAMPLE_RATE / 1000)

# Partials interval
PARTIAL_INTERVAL_S = 2.0

# Frame size in bytes (480 samples * 2 bytes per int16)
FRAME_BYTES = FRAME_SAMPLES * 2


def _pcm_to_wav_bytes(pcm: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Convert PCM int16 numpy array to WAV file bytes."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def _save_pcm_temp(pcm: np.ndarray) -> str:
    """Save PCM to a temp WAV file and return the path."""
    wav_bytes = _pcm_to_wav_bytes(pcm)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.write(wav_bytes)
    tmp.close()
    return tmp.name


EventCallback = Callable[[str, dict], Awaitable[None]]


def _apply_corrections(text: str, corrections: list[dict]) -> str:
    """Apply high-frequency corrections as whole-word replacements.

    Uses word boundaries to avoid partial matches (e.g. "eco" should not
    replace the "eco" in "ecology").
    """
    if not corrections or not text:
        return text
    for c in corrections:
        original = c["original"]
        corrected = c["corrected"]
        # Escape regex special chars in the original, match whole words only
        pattern = r"\b" + re.escape(original) + r"\b"
        text = re.sub(pattern, corrected, text, flags=re.IGNORECASE)
    return text


class DictationSession:
    """Manages a single dictation session over WebSocket.

    Args:
        language: Language code ("pt", "en", etc.)
        callback: Async function called with (event_type, data) for each event.
        enable_cleanup: Whether to run Claude cleanup on stop.
    """

    def __init__(
        self,
        language: str = "",
        callback: Optional[EventCallback] = None,
        enable_cleanup: bool = True,
    ):
        self.language = language
        self.callback = callback
        self.enable_cleanup = enable_cleanup

        self._vad = StreamingVAD(
            threshold=0.35,
            min_speech_duration_ms=160,
            min_silence_duration_ms=SILENCE_END_MS,
        )
        self._ffmpeg_proc: Optional[asyncio.subprocess.Process] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._processor_task: Optional[asyncio.Task] = None

        # PCM buffer from ffmpeg output
        self._pcm_queue: asyncio.Queue[bytes | None] = asyncio.Queue()

        # Segment state
        self._segment_id = 0
        self._ring_buffer: list[np.ndarray] = []  # recent frames for pre-roll
        self._ring_max = max(1, PRE_ROLL_SAMPLES // FRAME_SAMPLES + 1)
        self._current_segment: list[np.ndarray] = []
        self._silence_frames_after_speech = 0
        self._in_speech = False
        self._last_partial_time = 0.0

        # Final transcriptions for all segments
        self._final_texts: list[str] = []
        self._initial_prompt: Optional[str] = None

        self._stopped = False

    async def start(self) -> None:
        """Start the ffmpeg decoder and processing pipeline."""
        self._vad.reset()
        self._initial_prompt = await asyncio.to_thread(
            self._build_prompt
        )

        # Start ffmpeg: WebM/Opus stdin → PCM stdout
        self._ffmpeg_proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-nostdin", "-hide_banner", "-loglevel", "error",
            "-f", "webm", "-i", "pipe:0",
            "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1",
            "pipe:1",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Background task: read PCM from ffmpeg stdout
        self._reader_task = asyncio.create_task(self._read_ffmpeg_output())
        # Background task: process PCM frames through VAD
        self._processor_task = asyncio.create_task(self._process_frames())

        log.info("DictationSession started (language=%s)", self.language)

    def _build_prompt(self) -> str:
        """Build initial prompt (blocking, call in thread)."""
        from .transcriber import _build_initial_prompt
        return _build_initial_prompt(self.language)

    async def feed_audio(self, chunk: bytes) -> None:
        """Feed a WebM/Opus audio chunk from the browser."""
        if self._stopped or self._ffmpeg_proc is None:
            return
        stdin = self._ffmpeg_proc.stdin
        if stdin is None:
            return
        try:
            stdin.write(chunk)
            await stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            log.warning("ffmpeg stdin pipe broken")

    async def stop(self) -> Optional[str]:
        """Stop recording, flush final segment, optionally run cleanup.

        Returns the full cleaned text (or None if no speech detected).
        """
        self._stopped = True

        # Close ffmpeg stdin to signal EOF
        if self._ffmpeg_proc and self._ffmpeg_proc.stdin:
            try:
                self._ffmpeg_proc.stdin.close()
                await self._ffmpeg_proc.stdin.wait_closed()
            except Exception:
                pass

        # Wait for reader to finish
        if self._reader_task:
            try:
                await asyncio.wait_for(self._reader_task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._reader_task.cancel()

        # Signal processor to stop
        await self._pcm_queue.put(None)

        # Wait for processor to finish
        if self._processor_task:
            try:
                await asyncio.wait_for(self._processor_task, timeout=120)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._processor_task.cancel()

        # Kill ffmpeg if still running
        if self._ffmpeg_proc and self._ffmpeg_proc.returncode is None:
            try:
                self._ffmpeg_proc.kill()
                await self._ffmpeg_proc.wait()
            except Exception:
                pass

        if not self._final_texts:
            return None

        full_text = " ".join(self._final_texts)

        # Optionally run cleanup
        if self.enable_cleanup and full_text.strip():
            try:
                from .cleanup import cleanup_text
                corrections = await asyncio.to_thread(
                    db.get_top_corrections, self.language, 50
                )
                cleaned = await cleanup_text(
                    full_text, language=self.language, corrections=corrections
                )
                await self._emit("cleanup", {"text": cleaned})
                return cleaned
            except Exception as e:
                log.error("Cleanup failed: %s", e)
                await self._emit("error", {"message": f"Cleanup failed: {e}"})

        return full_text

    async def destroy(self) -> None:
        """Force cleanup all resources."""
        self._stopped = True

        for task in (self._reader_task, self._processor_task):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

        if self._ffmpeg_proc and self._ffmpeg_proc.returncode is None:
            try:
                self._ffmpeg_proc.kill()
                await self._ffmpeg_proc.wait()
            except Exception:
                pass

    # ── Internal pipeline tasks ──────────────────────────────────────

    async def _read_ffmpeg_output(self) -> None:
        """Read PCM data from ffmpeg stdout and put into queue."""
        stdout = self._ffmpeg_proc.stdout
        if stdout is None:
            log.error("ffmpeg stdout is None")
            return
        total_read = 0
        try:
            while True:
                data = await stdout.read(FRAME_BYTES * 10)  # read ~300ms at a time
                if not data:
                    print(f"[FFMPEG] EOF after {total_read} bytes", flush=True)
                    break
                total_read += len(data)
                if total_read <= FRAME_BYTES * 10:
                    print(f"[FFMPEG] First PCM chunk: {len(data)} bytes", flush=True)
                await self._pcm_queue.put(data)
        except (asyncio.CancelledError, Exception) as e:
            if not isinstance(e, asyncio.CancelledError):
                print(f"[FFMPEG] Reader error: {e}", flush=True)
        finally:
            # Check ffmpeg stderr for errors
            if self._ffmpeg_proc and self._ffmpeg_proc.stderr:
                try:
                    stderr_data = await asyncio.wait_for(
                        self._ffmpeg_proc.stderr.read(), timeout=2
                    )
                    if stderr_data:
                        print(f"[FFMPEG] stderr: {stderr_data.decode(errors='replace')}", flush=True)
                except Exception:
                    pass
            print(f"[FFMPEG] Reader done. Total: {total_read} bytes", flush=True)
            await self._pcm_queue.put(None)  # signal end

    async def _process_frames(self) -> None:
        """Consume PCM from queue, run VAD, assemble segments, dispatch transcription."""
        pcm_buffer = bytearray()
        frame_count = 0

        try:
            while True:
                data = await self._pcm_queue.get()
                if data is None:
                    break

                pcm_buffer.extend(data)

                # Process complete frames
                while len(pcm_buffer) >= FRAME_BYTES:
                    frame_bytes = bytes(pcm_buffer[:FRAME_BYTES])
                    del pcm_buffer[:FRAME_BYTES]
                    frame = np.frombuffer(frame_bytes, dtype=np.int16).copy()
                    frame_count += 1

                    # Log first few frames and every 100th
                    if frame_count <= 5 or frame_count % 100 == 0:
                        rms = np.sqrt(np.mean(frame.astype(np.float32) ** 2))
                        print(f"[FRAMES] #{frame_count}: rms={rms:.0f} max={np.max(np.abs(frame))}", flush=True)

                    await self._process_single_frame(frame)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[FRAMES] ERROR: {e}", flush=True)
            import traceback
            traceback.print_exc()
            await self._emit("error", {"message": f"Processing error: {e}"})

        # Flush any remaining segment
        if self._current_segment and self._in_speech:
            await self._finalize_segment()

    async def _process_single_frame(self, frame: np.ndarray) -> None:
        """Process one 30ms PCM frame through VAD and segment assembly."""
        # Run VAD (lightweight, OK on event loop — ~0.1ms per frame)
        state = await asyncio.to_thread(self._vad.process_frame, frame)

        # Always maintain ring buffer for pre-roll
        self._ring_buffer.append(frame)
        if len(self._ring_buffer) > self._ring_max:
            self._ring_buffer.pop(0)

        if state == VadState.SPEECH_START:
            if not self._in_speech:
                self._in_speech = True
                self._silence_frames_after_speech = 0
                self._segment_id += 1
                print(f"[VAD] Speech START (segment {self._segment_id})", flush=True)

                # Add pre-roll from ring buffer
                self._current_segment = list(self._ring_buffer[:-1])  # everything except current
                self._current_segment.append(frame)

                await self._emit("vad_state", {"is_speech": True})
                self._last_partial_time = time.monotonic()
            else:
                # Merge: silence gap was short enough, keep accumulating
                self._silence_frames_after_speech = 0
                self._current_segment.append(frame)

        elif state == VadState.SPEECH:
            self._current_segment.append(frame)
            self._silence_frames_after_speech = 0

            # Emit partial transcription periodically
            now = time.monotonic()
            if now - self._last_partial_time >= PARTIAL_INTERVAL_S:
                self._last_partial_time = now
                asyncio.create_task(self._emit_partial())

        elif state == VadState.SPEECH_END:
            # Add post-roll frames
            self._current_segment.append(frame)
            self._in_speech = False
            print(f"[VAD] Speech END (segment {self._segment_id}, {len(self._current_segment)} frames)", flush=True)

            await self._emit("vad_state", {"is_speech": False})
            await self._finalize_segment()

        elif state == VadState.SILENCE:
            if self._in_speech:
                # Still in speech region but getting silence frames
                self._current_segment.append(frame)
                self._silence_frames_after_speech += 1

    async def _emit_partial(self) -> None:
        """Transcribe current accumulated audio as a partial (fast, beam_size=1)."""
        if not self._current_segment:
            return

        pcm = np.concatenate(self._current_segment)
        if len(pcm) < MIN_SEGMENT_SAMPLES:
            return

        try:
            tmp_path = await asyncio.to_thread(_save_pcm_temp, pcm)
            try:
                from .transcriber import transcribe_fast
                result = await transcribe_fast(
                    tmp_path, language=self.language, initial_prompt=self._initial_prompt
                )
                text = result.get("text", "")
                if text:
                    await self._emit("partial", {
                        "segment_id": self._segment_id,
                        "text": text,
                    })
            finally:
                Path(tmp_path).unlink(missing_ok=True)
        except Exception as e:
            log.warning("Partial transcription failed: %s", e)

    async def _finalize_segment(self) -> None:
        """Transcribe a completed speech segment (full quality, beam_size=5)."""
        if not self._current_segment:
            return

        pcm = np.concatenate(self._current_segment)
        self._current_segment = []
        self._silence_frames_after_speech = 0

        duration_ms = len(pcm) * 1000 // SAMPLE_RATE
        print(f"[TRANSCRIBE] Segment {self._segment_id}: {len(pcm)} samples ({duration_ms}ms)", flush=True)

        # Discard short segments
        if len(pcm) < MIN_SEGMENT_SAMPLES:
            print(f"[TRANSCRIBE] Discarding short segment ({duration_ms}ms < {MIN_SEGMENT_MS}ms)", flush=True)
            return

        segment_id = self._segment_id

        try:
            tmp_path = await asyncio.to_thread(_save_pcm_temp, pcm)
            try:
                from .transcriber import transcribe
                print(f"[TRANSCRIBE] Calling faster-whisper (lang={self.language})...", flush=True)
                result = await transcribe(
                    tmp_path, language=self.language, initial_prompt=self._initial_prompt
                )
                text = result.get("text", "")
                print(f"[TRANSCRIBE] Result: '{text[:100]}' (time={result.get('transcription_time', '?')}s)", flush=True)
                if text:
                    # Apply high-frequency corrections as post-processing
                    hi_freq = await asyncio.to_thread(
                        db.get_high_frequency_corrections, self.language, 3
                    )
                    if hi_freq:
                        text = _apply_corrections(text, hi_freq)

                    self._final_texts.append(text)
                    await self._emit("final", {
                        "segment_id": segment_id,
                        "text": text,
                    })
            finally:
                Path(tmp_path).unlink(missing_ok=True)
        except Exception as e:
            print(f"[TRANSCRIBE] ERROR: {e}", flush=True)
            import traceback
            traceback.print_exc()
            await self._emit("error", {
                "message": f"Transcription failed for segment {segment_id}: {e}"
            })

    async def _emit(self, event_type: str, data: dict) -> None:
        """Send an event via the callback."""
        if self.callback:
            try:
                await self.callback(event_type, data)
            except Exception as e:
                log.warning("Callback error for %s: %s", event_type, e)
