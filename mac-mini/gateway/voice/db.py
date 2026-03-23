"""SQLite persistence for voice dictation — corrections, vocabulary, preferences, logs."""

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_local = threading.local()

DB_PATH: Path | None = None


def init_db(db_path: Path) -> None:
    """Set the DB path and create tables if needed."""
    global DB_PATH
    DB_PATH = db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS corrections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original TEXT NOT NULL,
            corrected TEXT NOT NULL,
            language TEXT NOT NULL DEFAULT '',
            frequency INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_corrections_unique
            ON corrections(original, corrected, language);

        CREATE TABLE IF NOT EXISTS vocabulary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            term TEXT NOT NULL,
            language TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_vocabulary_unique
            ON vocabulary(term, language);

        CREATE TABLE IF NOT EXISTS preferences (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transcription_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            language TEXT NOT NULL DEFAULT '',
            original_text TEXT NOT NULL,
            edited_text TEXT NOT NULL DEFAULT '',
            cleaned_text TEXT NOT NULL DEFAULT '',
            duration_seconds REAL NOT NULL DEFAULT 0,
            corrections_applied TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
        );
    """)
    conn.commit()


def _get_conn() -> sqlite3.Connection:
    """Get a thread-local SQLite connection."""
    if not hasattr(_local, "conn") or _local.conn is None:
        if DB_PATH is None:
            raise RuntimeError("Voice DB not initialized — call init_db() first")
        _local.conn = sqlite3.connect(str(DB_PATH))
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Corrections ──────────────────────────────────────────────────────


def list_corrections(
    language: str = "", limit: int = 50, offset: int = 0
) -> tuple[list[dict], int]:
    conn = _get_conn()
    where = "WHERE language = ?" if language else ""
    params: tuple = (language,) if language else ()

    total = conn.execute(
        f"SELECT COUNT(*) FROM corrections {where}", params
    ).fetchone()[0]

    rows = conn.execute(
        f"SELECT * FROM corrections {where} ORDER BY frequency DESC, updated_at DESC LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    return [dict(r) for r in rows], total


def add_correction(original: str, corrected: str, language: str = "") -> dict:
    conn = _get_conn()
    now = _now()
    try:
        conn.execute(
            "INSERT INTO corrections (original, corrected, language, frequency, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
            (original, corrected, language, now, now),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.execute(
            "UPDATE corrections SET frequency = frequency + 1, updated_at = ? WHERE original = ? AND corrected = ? AND language = ?",
            (now, original, corrected, language),
        )
        conn.commit()
    row = conn.execute(
        "SELECT * FROM corrections WHERE original = ? AND corrected = ? AND language = ?",
        (original, corrected, language),
    ).fetchone()
    return dict(row)


def add_corrections_batch(
    corrections: list[dict], language: str = ""
) -> dict:
    added = 0
    updated = 0
    conn = _get_conn()
    now = _now()
    for c in corrections:
        orig = c.get("original", "")
        corr = c.get("corrected", "")
        lang = c.get("language", language)
        if not orig or not corr:
            continue
        try:
            conn.execute(
                "INSERT INTO corrections (original, corrected, language, frequency, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
                (orig, corr, lang, now, now),
            )
            added += 1
        except sqlite3.IntegrityError:
            conn.execute(
                "UPDATE corrections SET frequency = frequency + 1, updated_at = ? WHERE original = ? AND corrected = ? AND language = ?",
                (now, orig, corr, lang),
            )
            updated += 1
    conn.commit()
    return {"added": added, "updated": updated}


def delete_correction(correction_id: int) -> bool:
    conn = _get_conn()
    cur = conn.execute("DELETE FROM corrections WHERE id = ?", (correction_id,))
    conn.commit()
    return cur.rowcount > 0


def get_top_corrections(language: str = "", limit: int = 50) -> list[dict]:
    conn = _get_conn()
    if language:
        rows = conn.execute(
            "SELECT original, corrected FROM corrections WHERE language = ? ORDER BY frequency DESC LIMIT ?",
            (language, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT original, corrected FROM corrections ORDER BY frequency DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_high_frequency_corrections(language: str = "", min_frequency: int = 3) -> list[dict]:
    """Get corrections with frequency >= min_frequency for automatic post-processing."""
    conn = _get_conn()
    if language:
        rows = conn.execute(
            "SELECT original, corrected FROM corrections WHERE language = ? AND frequency >= ? ORDER BY frequency DESC",
            (language, min_frequency),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT original, corrected FROM corrections WHERE frequency >= ? ORDER BY frequency DESC",
            (min_frequency,),
        ).fetchall()
    return [dict(r) for r in rows]


# ── Vocabulary ───────────────────────────────────────────────────────


def list_vocabulary(language: str = "") -> list[dict]:
    conn = _get_conn()
    if language:
        rows = conn.execute(
            "SELECT * FROM vocabulary WHERE language = ? ORDER BY term", (language,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM vocabulary ORDER BY term").fetchall()
    return [dict(r) for r in rows]


def add_vocabulary(term: str, language: str = "", category: str = "") -> dict:
    conn = _get_conn()
    now = _now()
    try:
        conn.execute(
            "INSERT INTO vocabulary (term, language, category, created_at) VALUES (?, ?, ?, ?)",
            (term, language, category, now),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        # Update category if it changed
        conn.execute(
            "UPDATE vocabulary SET category = ? WHERE term = ? AND language = ?",
            (category, term, language),
        )
        conn.commit()
    row = conn.execute(
        "SELECT * FROM vocabulary WHERE term = ? AND language = ?", (term, language)
    ).fetchone()
    return dict(row)


def delete_vocabulary(vocab_id: int) -> bool:
    conn = _get_conn()
    cur = conn.execute("DELETE FROM vocabulary WHERE id = ?", (vocab_id,))
    conn.commit()
    return cur.rowcount > 0


# ── Preferences ──────────────────────────────────────────────────────


def get_preferences() -> dict[str, str]:
    conn = _get_conn()
    rows = conn.execute("SELECT key, value FROM preferences").fetchall()
    return {r["key"]: r["value"] for r in rows}


def set_preference(key: str, value: str) -> None:
    conn = _get_conn()
    conn.execute(
        "INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()


# ── Transcription log ────────────────────────────────────────────────


def log_transcription(
    *,
    session_id: str = "",
    language: str = "",
    original_text: str = "",
    edited_text: str = "",
    cleaned_text: str = "",
    duration_seconds: float = 0,
    corrections_applied: str = "[]",
) -> int:
    conn = _get_conn()
    cur = conn.execute(
        "INSERT INTO transcription_log (session_id, language, original_text, edited_text, cleaned_text, duration_seconds, corrections_applied, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (session_id, language, original_text, edited_text, cleaned_text, duration_seconds, corrections_applied, _now()),
    )
    conn.commit()
    return cur.lastrowid
