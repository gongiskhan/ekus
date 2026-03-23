"""Silero VAD streaming wrapper for real-time speech detection (PyTorch)."""

import logging
from enum import Enum
from typing import Optional

import numpy as np
import torch

log = logging.getLogger(__name__)

SAMPLE_RATE = 16000
FRAME_SAMPLES = 512  # 32ms at 16kHz (Silero VAD required frame size)

_model = None


def _get_model():
    """Lazy-load the Silero VAD PyTorch model (singleton)."""
    global _model
    if _model is None:
        from silero_vad import load_silero_vad
        _model = load_silero_vad(onnx=False)
        print("[VAD] Silero VAD PyTorch model loaded.", flush=True)
    return _model


class VadState(str, Enum):
    SILENCE = "silence"
    SPEECH_START = "speech_start"
    SPEECH = "speech"
    SPEECH_END = "speech_end"


class StreamingVAD:
    """Processes PCM audio in 32ms frames and detects speech boundaries.

    Feed 512-sample (32ms) frames of 16kHz mono PCM via `process_frame()`.
    Returns a VadState for each frame.
    """

    def __init__(
        self,
        threshold: float = 0.5,
        min_speech_duration_ms: int = 250,
        min_silence_duration_ms: int = 600,
    ):
        self.threshold = threshold
        self.min_speech_frames = max(1, min_speech_duration_ms // 32)
        self.min_silence_frames = max(1, min_silence_duration_ms // 32)

        self._state = VadState.SILENCE
        self._speech_count = 0
        self._silence_count = 0
        self._triggered = False
        self._frame_count = 0

    def reset(self) -> None:
        """Reset VAD state for a new stream."""
        self._state = VadState.SILENCE
        self._speech_count = 0
        self._silence_count = 0
        self._triggered = False
        self._frame_count = 0
        model = _get_model()
        model.reset_states()

    def process_frame(self, pcm_frame: bytes | np.ndarray) -> VadState:
        """Process a single 32ms PCM frame (512 samples, 16kHz, mono, int16).

        Args:
            pcm_frame: Either raw bytes (1024 bytes = 512 int16 samples)
                       or a numpy int16 array of 512 samples.

        Returns:
            Current VadState after processing this frame.
        """
        model = _get_model()

        # Convert to float32 tensor in [-1, 1]
        if isinstance(pcm_frame, (bytes, bytearray)):
            samples = np.frombuffer(pcm_frame, dtype=np.int16)
        else:
            samples = pcm_frame

        audio_float = torch.from_numpy(samples.astype(np.float32) / 32768.0)

        # Run inference
        prob = model(audio_float, SAMPLE_RATE).item()
        is_speech = prob >= self.threshold

        # Diagnostic logging
        self._frame_count += 1
        if self._frame_count <= 5 or self._frame_count % 100 == 0 or prob > 0.3:
            print(f"[VAD] frame={self._frame_count} prob={prob:.3f} speech={is_speech} triggered={self._triggered}", flush=True)

        if is_speech:
            self._speech_count += 1
            self._silence_count = 0
        else:
            self._silence_count += 1
            self._speech_count = 0

        # State machine
        if not self._triggered:
            if self._speech_count >= self.min_speech_frames:
                self._triggered = True
                self._state = VadState.SPEECH_START
            else:
                self._state = VadState.SILENCE
        else:
            if self._silence_count >= self.min_silence_frames:
                self._triggered = False
                self._state = VadState.SPEECH_END
            else:
                self._state = VadState.SPEECH

        return self._state

    @property
    def is_speech(self) -> bool:
        return self._triggered
