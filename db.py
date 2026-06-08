"""
db.py — SQLite persistence layer for RAG Chat sessions, messages, and documents.
"""

import sqlite3
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "rag_chat.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create tables if they don't exist."""
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS chats (
                chat_id     TEXT PRIMARY KEY,
                title       TEXT NOT NULL DEFAULT 'New Chat',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id     TEXT NOT NULL REFERENCES chats(chat_id),
                role        TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content     TEXT NOT NULL,
                citations   TEXT,          -- JSON array of citation objects
                created_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS documents (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id     TEXT NOT NULL REFERENCES chats(chat_id),
                filename    TEXT NOT NULL,
                file_type   TEXT NOT NULL,
                num_chunks  INTEGER NOT NULL DEFAULT 0,
                num_pages   INTEGER NOT NULL DEFAULT 0,
                uploaded_at TEXT NOT NULL
            );
        """)


# ─────────────────────────────────────────────────────────────
# Chat CRUD
# ─────────────────────────────────────────────────────────────

def create_chat(chat_id: str, title: str = "New Chat") -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO chats (chat_id, title, created_at, updated_at) VALUES (?,?,?,?)",
            (chat_id, title, now, now)
        )
    return get_chat(chat_id)


def get_chat(chat_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM chats WHERE chat_id=?", (chat_id,)).fetchone()
        return dict(row) if row else None


def list_chats() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM chats ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def update_chat_title(chat_id: str, title: str):
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE chats SET title=?, updated_at=? WHERE chat_id=?",
            (title, now, chat_id)
        )


def touch_chat(chat_id: str):
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE chats SET updated_at=? WHERE chat_id=?",
            (now, chat_id)
        )


def delete_chat(chat_id: str):
    """Delete a chat and all related messages and documents."""
    with get_conn() as conn:
        conn.execute("DELETE FROM messages  WHERE chat_id=?", (chat_id,))
        conn.execute("DELETE FROM documents WHERE chat_id=?", (chat_id,))
        conn.execute("DELETE FROM chats     WHERE chat_id=?", (chat_id,))


# ─────────────────────────────────────────────────────────────
# Messages CRUD
# ─────────────────────────────────────────────────────────────

def add_message(chat_id: str, role: str, content: str, citations: list = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    citations_json = json.dumps(citations or [])
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO messages (chat_id, role, content, citations, created_at) VALUES (?,?,?,?,?)",
            (chat_id, role, content, citations_json, now)
        )
        msg_id = cur.lastrowid
    touch_chat(chat_id)
    return {
        "id": msg_id,
        "chat_id": chat_id,
        "role": role,
        "content": content,
        "citations": citations or [],
        "created_at": now,
    }


def get_messages(chat_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE chat_id=? ORDER BY id ASC",
            (chat_id,)
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["citations"] = json.loads(d["citations"] or "[]")
            result.append(d)
        return result


# ─────────────────────────────────────────────────────────────
# Documents CRUD
# ─────────────────────────────────────────────────────────────

def add_document(chat_id: str, filename: str, file_type: str,
                 num_chunks: int, num_pages: int) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO documents (chat_id, filename, file_type, num_chunks, num_pages, uploaded_at)
               VALUES (?,?,?,?,?,?)""",
            (chat_id, filename, file_type, num_chunks, num_pages, now)
        )
        doc_id = cur.lastrowid
    return {
        "id": doc_id,
        "chat_id": chat_id,
        "filename": filename,
        "file_type": file_type,
        "num_chunks": num_chunks,
        "num_pages": num_pages,
        "uploaded_at": now,
    }


def get_documents(chat_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM documents WHERE chat_id=? ORDER BY id ASC",
            (chat_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_document_by_id(doc_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
        return dict(row) if row else None


def delete_document(doc_id: int):
    """Remove a single document record."""
    with get_conn() as conn:
        conn.execute("DELETE FROM documents WHERE id=?", (doc_id,))


# Initialize DB on import
init_db()
