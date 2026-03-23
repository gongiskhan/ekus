"""Claude-based text cleanup for voice transcriptions."""

import asyncio
import logging
import os
from typing import Optional

log = logging.getLogger(__name__)

CLAUDE_BIN = "/opt/homebrew/bin/claude"


def _build_cleanup_prompt(text: str, language: str = "", corrections: Optional[list[dict]] = None) -> str:
    """Build the cleanup system prompt."""
    corr_section = ""
    if corrections:
        pairs = [f'"{c["original"]}" → "{c["corrected"]}"' for c in corrections]
        corr_section = f"\n\nApply these known corrections:\n" + "\n".join(f"- {p}" for p in pairs)

    lang_note = ""
    if language == "pt":
        lang_note = "\n- Preserve Portuguese from Portugal (PT-PT) spelling and expressions — do NOT convert to Brazilian Portuguese."
    elif language:
        lang_note = f"\n- Preserve the {language} language."

    return f"""Fix this voice transcription. Rules:
- Fix punctuation and capitalization
- Remove filler words (um, uh, like, tipo, pronto, etc.)
- Remove false starts and repetitions
- Preserve the original meaning, tone, and structure
- Preserve proper nouns, brand names, and technical terms exactly as spoken{lang_note}{corr_section}

Return ONLY the cleaned text — no commentary, no quotes, no explanation.

Transcription:
{text}"""


async def cleanup_text(
    text: str, language: str = "", corrections: Optional[list[dict]] = None
) -> str:
    """Run Claude CLI to clean up transcribed text.

    Returns the cleaned text, or the original text if cleanup fails.
    """
    if not text.strip():
        return text

    prompt = _build_cleanup_prompt(text, language, corrections)

    # Strip API keys so claude CLI uses its own OAuth auth
    cli_env = {
        k: v for k, v in os.environ.items()
        if k not in ("ANTHROPIC_API_KEY", "ANTH_API_KEY")
    }

    try:
        proc = await asyncio.create_subprocess_exec(
            CLAUDE_BIN, "-p", "--output-format", "text",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=cli_env,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(prompt.encode()), timeout=60
        )

        if proc.returncode != 0:
            log.error("Claude cleanup failed: %s", stderr.decode()[:300])
            return text

        cleaned = stdout.decode().strip()
        return cleaned if cleaned else text

    except asyncio.TimeoutError:
        log.error("Claude cleanup timed out after 60s")
        return text
    except Exception as e:
        log.error("Claude cleanup error: %s", e)
        return text
