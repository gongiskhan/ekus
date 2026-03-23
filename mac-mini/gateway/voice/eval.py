"""Evaluation harness for voice transcription quality.

Measures WER (Word Error Rate) across different pipeline variants:
  - baseline: faster-whisper only, no prompt, no VAD
  - prompted: + language-aware prompt + vocabulary from DB
  - corrected: + correction memory in prompt
  - cleaned: + Claude cleanup pass

Usage:
    cd mac-mini/gateway
    uv run python -m voice.eval --test-dir ../../data/voice/eval/ --language pt
    uv run python -m voice.eval --test-dir ../../data/voice/eval/ --variants baseline,prompted
"""

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)


# ── WER computation ──────────────────────────────────────────────────


def _edit_distance(ref: list[str], hyp: list[str]) -> tuple[int, int, int]:
    """Levenshtein edit distance returning (substitutions, deletions, insertions)."""
    n = len(ref)
    m = len(hyp)

    # dp[i][j] = (cost, subs, dels, ins) for ref[:i] vs hyp[:j]
    dp = [[(0, 0, 0, 0)] * (m + 1) for _ in range(n + 1)]

    for i in range(1, n + 1):
        dp[i][0] = (i, 0, i, 0)  # all deletions
    for j in range(1, m + 1):
        dp[0][j] = (j, 0, 0, j)  # all insertions

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if ref[i - 1] == hyp[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                # Substitution
                sub_cost, sub_s, sub_d, sub_i = dp[i - 1][j - 1]
                sub = (sub_cost + 1, sub_s + 1, sub_d, sub_i)

                # Deletion (word in ref but not in hyp)
                del_cost, del_s, del_d, del_i = dp[i - 1][j]
                delete = (del_cost + 1, del_s, del_d + 1, del_i)

                # Insertion (word in hyp but not in ref)
                ins_cost, ins_s, ins_d, ins_i = dp[i][j - 1]
                insert = (ins_cost + 1, ins_s, ins_d, ins_i + 1)

                dp[i][j] = min(sub, delete, insert, key=lambda x: x[0])

    _, s, d, ins = dp[n][m]
    return s, d, ins


def compute_wer(reference: str, hypothesis: str) -> dict:
    """Compute Word Error Rate between reference and hypothesis text.

    Returns dict with wer, substitutions, deletions, insertions, ref_words.
    """
    ref_words = _normalize(reference).split()
    hyp_words = _normalize(hypothesis).split()

    if not ref_words:
        return {
            "wer": 0.0 if not hyp_words else 1.0,
            "substitutions": 0,
            "deletions": 0,
            "insertions": len(hyp_words),
            "ref_words": 0,
        }

    s, d, i = _edit_distance(ref_words, hyp_words)
    n = len(ref_words)
    wer = (s + d + i) / n

    return {
        "wer": round(wer, 4),
        "substitutions": s,
        "deletions": d,
        "insertions": i,
        "ref_words": n,
    }


def _normalize(text: str) -> str:
    """Lowercase and strip punctuation for fair WER comparison."""
    import re

    text = text.lower().strip()
    # Remove punctuation but keep spaces and alphanumeric + accented chars
    text = re.sub(r"[^\w\s]", "", text, flags=re.UNICODE)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text)
    return text.strip()


# ── Pipeline variants ────────────────────────────────────────────────


async def _run_baseline(audio_path: str, language: str) -> str:
    """Variant 1: Raw transcription — no prompt, no VAD."""
    from voice.transcriber import _transcribe_sync

    result = await asyncio.to_thread(
        _transcribe_sync, audio_path, language, initial_prompt=""
    )
    return result.get("text", "")


async def _run_prompted(audio_path: str, language: str) -> str:
    """Variant 2: With language-aware prompt + vocabulary."""
    from voice.transcriber import _transcribe_sync, _build_initial_prompt

    prompt = await asyncio.to_thread(_build_initial_prompt, language)
    result = await asyncio.to_thread(
        _transcribe_sync, audio_path, language, initial_prompt=prompt
    )
    return result.get("text", "")


async def _run_corrected(audio_path: str, language: str) -> str:
    """Variant 3: Prompted + correction memory in prompt."""
    from voice.transcriber import _transcribe_sync, _build_initial_prompt

    # _build_initial_prompt already includes corrections from DB
    prompt = await asyncio.to_thread(_build_initial_prompt, language)
    result = await asyncio.to_thread(
        _transcribe_sync, audio_path, language, initial_prompt=prompt
    )
    return result.get("text", "")


async def _run_cleaned(audio_path: str, language: str) -> str:
    """Variant 4: Full pipeline — prompted transcription + Claude cleanup."""
    from voice.transcriber import _transcribe_sync, _build_initial_prompt
    from voice.cleanup import cleanup_text
    from voice import db

    prompt = await asyncio.to_thread(_build_initial_prompt, language)
    result = await asyncio.to_thread(
        _transcribe_sync, audio_path, language, initial_prompt=prompt
    )
    text = result.get("text", "")
    if not text.strip():
        return text

    corrections = await asyncio.to_thread(
        db.get_top_corrections, language, 50
    )
    cleaned = await cleanup_text(text, language=language, corrections=corrections)
    return cleaned


VARIANTS = {
    "baseline": _run_baseline,
    "prompted": _run_prompted,
    "corrected": _run_corrected,
    "cleaned": _run_cleaned,
}


# ── Test corpus discovery ────────────────────────────────────────────


def discover_test_cases(test_dir: Path) -> list[tuple[Path, str]]:
    """Find all .wav/.txt pairs in the test directory.

    Returns list of (audio_path, reference_text).
    """
    cases = []
    for audio_file in sorted(test_dir.glob("*.wav")):
        txt_file = audio_file.with_suffix(".txt")
        if txt_file.exists():
            reference = txt_file.read_text(encoding="utf-8").strip()
            if reference:
                cases.append((audio_file, reference))
            else:
                log.warning("Empty reference file: %s", txt_file)
        else:
            log.warning("No reference .txt for: %s", audio_file)
    return cases


# ── Main evaluation loop ─────────────────────────────────────────────


async def run_eval(
    test_dir: Path,
    language: str = "pt",
    variant_names: Optional[list[str]] = None,
) -> list[dict]:
    """Run evaluation across all test cases and variants.

    Returns list of result dicts for each (file, variant) pair.
    """
    # Init DB (needed for prompted/corrected/cleaned variants)
    from voice import db

    db_path = Path(__file__).resolve().parent.parent / "data" / "voice" / "dictation.db"
    if not db.DB_PATH:
        if db_path.exists():
            db.init_db(db_path)
        else:
            # Create an empty DB so vocab/corrections queries don't fail
            db.init_db(db_path)

    cases = discover_test_cases(test_dir)
    if not cases:
        print(f"No test cases found in {test_dir}")
        print("Expected: .wav files alongside .txt files with same base name")
        return []

    if variant_names is None or variant_names == ["all"]:
        variant_names = list(VARIANTS.keys())

    # Validate variant names
    for v in variant_names:
        if v not in VARIANTS:
            print(f"Unknown variant: {v}")
            print(f"Available: {', '.join(VARIANTS.keys())}")
            return []

    results = []
    total = len(cases) * len(variant_names)
    current = 0

    for audio_path, reference in cases:
        for variant_name in variant_names:
            current += 1
            fname = audio_path.stem
            print(
                f"  [{current}/{total}] {fname} / {variant_name}...",
                end="",
                flush=True,
            )

            t0 = time.monotonic()
            try:
                hypothesis = await VARIANTS[variant_name](str(audio_path), language)
            except Exception as e:
                print(f" ERROR: {e}")
                results.append({
                    "file": fname,
                    "variant": variant_name,
                    "reference": reference,
                    "hypothesis": f"[ERROR: {e}]",
                    "wer": 1.0,
                    "substitutions": 0,
                    "deletions": 0,
                    "insertions": 0,
                    "ref_words": 0,
                    "time_s": 0,
                })
                continue

            elapsed = time.monotonic() - t0
            metrics = compute_wer(reference, hypothesis)
            print(f" WER={metrics['wer']:.2%} ({elapsed:.1f}s)")

            results.append({
                "file": fname,
                "variant": variant_name,
                "reference": reference,
                "hypothesis": hypothesis,
                "time_s": round(elapsed, 2),
                **metrics,
            })

    return results


# ── Output formatting ────────────────────────────────────────────────


def print_results_table(results: list[dict]) -> None:
    """Print results as a Markdown table."""
    if not results:
        return

    print("\n## Results\n")
    print("| File | Variant | WER | S | D | I | Ref Words | Time | Reference | Hypothesis |")
    print("|------|---------|-----|---|---|---|-----------|------|-----------|------------|")

    for r in results:
        ref_short = r["reference"][:50] + ("..." if len(r["reference"]) > 50 else "")
        hyp_short = r["hypothesis"][:50] + ("..." if len(r["hypothesis"]) > 50 else "")
        print(
            f"| {r['file']} | {r['variant']} | {r['wer']:.2%} "
            f"| {r['substitutions']} | {r['deletions']} | {r['insertions']} "
            f"| {r['ref_words']} | {r['time_s']}s "
            f"| {ref_short} | {hyp_short} |"
        )


def print_summary(results: list[dict]) -> None:
    """Print summary metrics per variant."""
    if not results:
        return

    # Group by variant
    variants: dict[str, list[dict]] = {}
    for r in results:
        variants.setdefault(r["variant"], []).append(r)

    print("\n## Summary\n")
    print("| Variant | Avg WER | Min WER | Max WER | Avg Time | Files |")
    print("|---------|---------|---------|---------|----------|-------|")

    for variant_name, variant_results in variants.items():
        wers = [r["wer"] for r in variant_results]
        times = [r["time_s"] for r in variant_results]
        avg_wer = sum(wers) / len(wers)
        min_wer = min(wers)
        max_wer = max(wers)
        avg_time = sum(times) / len(times)
        print(
            f"| {variant_name} | {avg_wer:.2%} | {min_wer:.2%} | {max_wer:.2%} "
            f"| {avg_time:.1f}s | {len(variant_results)} |"
        )

    # Most corrected words (from DB)
    try:
        from voice import db

        if db.DB_PATH:
            corrections = db.get_top_corrections(limit=10)
            if corrections:
                print("\n## Top Corrections (from DB)\n")
                print("| Original | Corrected |")
                print("|----------|-----------|")
                for c in corrections:
                    print(f"| {c['original']} | {c['corrected']} |")

            # Total corrections count
            all_corrections, total = db.list_corrections(limit=1)
            print(f"\nTotal corrections in DB: {total}")
    except Exception:
        pass


# ── CLI ──────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Evaluate voice transcription quality across pipeline variants"
    )
    parser.add_argument(
        "--test-dir",
        type=Path,
        required=True,
        help="Directory containing .wav + .txt test pairs",
    )
    parser.add_argument(
        "--language",
        type=str,
        default="pt",
        help="Language code (default: pt)",
    )
    parser.add_argument(
        "--variants",
        type=str,
        default="all",
        help="Comma-separated variant names: all, baseline, prompted, corrected, cleaned",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable debug logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )

    test_dir = args.test_dir.resolve()
    if not test_dir.is_dir():
        print(f"Error: {test_dir} is not a directory")
        sys.exit(1)

    variant_names = (
        None if args.variants == "all" else args.variants.split(",")
    )

    print(f"Voice Evaluation Harness")
    print(f"  Test dir:  {test_dir}")
    print(f"  Language:  {args.language}")
    print(f"  Variants:  {args.variants}")
    print()

    results = asyncio.run(
        run_eval(test_dir, language=args.language, variant_names=variant_names)
    )

    print_results_table(results)
    print_summary(results)


if __name__ == "__main__":
    main()
