"""
app.py — Flask REST API for the RAG Chat Web Interface.

Endpoints:
  POST /api/chat/new                 — Create new chat session
  GET  /api/chats                    — List all chat sessions
  GET  /api/chat/<chat_id>           — Get chat details
  GET  /api/chat/<chat_id>/history   — Get full message history
  GET  /api/chat/<chat_id>/documents — List uploaded docs for a chat
  POST /api/upload                   — Upload a file into a chat
  POST /api/query                    — Ask a question (SSE streaming)
"""

import os
import uuid
import json
import tempfile
from pathlib import Path

from flask import (
    Flask, request, jsonify, Response,
    render_template, stream_with_context
)
from werkzeug.utils import secure_filename

import db
import rag_engine

# ──────────────────────────────────────────────────────────
# Flask setup
# ──────────────────────────────────────────────────────────
BASE_DIR  = os.path.dirname(__file__)
UPLOAD_TMP = os.path.join(BASE_DIR, "upload_tmp")
os.makedirs(UPLOAD_TMP, exist_ok=True)

ALLOWED_EXTENSIONS = {".pdf", ".html", ".htm", ".txt", ".docx", ".md"}

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB max


# ──────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────

def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _error(msg: str, status: int = 400):
    return jsonify({"error": msg}), status


# ──────────────────────────────────────────────────────────
# Routes — pages
# ──────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ──────────────────────────────────────────────────────────
# Routes — Chat management
# ──────────────────────────────────────────────────────────

@app.route("/api/chat/new", methods=["POST"])
def new_chat():
    """Create a brand-new chat session and return its UUID."""
    body  = request.get_json(silent=True) or {}
    title = body.get("title", "New Chat")
    chat_id = str(uuid.uuid4())
    chat = db.create_chat(chat_id, title)
    return jsonify(chat), 201


@app.route("/api/chats", methods=["GET"])
def list_chats():
    return jsonify(db.list_chats())


@app.route("/api/chat/<chat_id>", methods=["GET"])
def get_chat(chat_id: str):
    chat = db.get_chat(chat_id)
    if not chat:
        return _error("Chat not found", 404)
    return jsonify(chat)


@app.route("/api/chat/<chat_id>/history", methods=["GET"])
def chat_history(chat_id: str):
    if not db.get_chat(chat_id):
        return _error("Chat not found", 404)
    messages = db.get_messages(chat_id)
    return jsonify(messages)


@app.route("/api/chat/<chat_id>/documents", methods=["GET"])
def chat_documents(chat_id: str):
    if not db.get_chat(chat_id):
        return _error("Chat not found", 404)
    docs = db.get_documents(chat_id)
    return jsonify(docs)


@app.route("/api/chat/<chat_id>", methods=["DELETE"])
def delete_chat(chat_id: str):
    """Delete a chat session and all its messages/documents metadata."""
    if not db.get_chat(chat_id):
        return _error("Chat not found", 404)
    db.delete_chat(chat_id)
    # Remove the FAISS vector store for this chat
    import shutil
    store_dir = os.path.join(rag_engine.VECTOR_STORE_ROOT, chat_id)
    if os.path.exists(store_dir):
        shutil.rmtree(store_dir, ignore_errors=True)
    return jsonify({"success": True, "deleted": chat_id})


@app.route("/api/chat/<chat_id>/rename", methods=["PUT"])
def rename_chat(chat_id: str):
    """Rename a chat."""
    data = request.json or {}
    title = data.get("title", "").strip()
    if not title:
        return _error("Title is required", 400)
    
    chat = db.get_chat(chat_id)
    if not chat:
        return _error("Chat not found", 404)
        
    db.update_chat_title(chat_id, title)
    return jsonify({"success": True, "chat_id": chat_id, "title": title})


@app.route("/api/chat/<chat_id>/share", methods=["GET"])
def share_chat(chat_id: str):
    """Return a shareable summary of the chat (title + messages count + doc list)."""
    chat = db.get_chat(chat_id)
    if not chat:
        return _error("Chat not found", 404)
    messages = db.get_messages(chat_id)
    docs     = db.get_documents(chat_id)
    return jsonify({
        "chat_id":       chat_id,
        "title":         chat["title"],
        "created_at":    chat["created_at"],
        "message_count": len(messages),
        "documents":     [{"filename": d["filename"], "file_type": d["file_type"],
                           "num_pages": d["num_pages"]} for d in docs],
        "share_url":     f"/chat/{chat_id}",
    })


@app.route("/api/chat/<chat_id>/document/<int:doc_id>", methods=["DELETE"])
def delete_document(chat_id: str, doc_id: int):
    """Remove a single document from a chat's DB record and FAISS index."""
    if not db.get_chat(chat_id):
        return _error("Chat not found", 404)
    doc = db.get_document_by_id(doc_id)
    if not doc or doc["chat_id"] != chat_id:
        return _error("Document not found", 404)

    filename = doc["filename"]
    # Remove from DB
    db.delete_document(doc_id)
    # Rebuild FAISS index without this file's chunks
    removed_chunks = rag_engine.remove_document_from_index(chat_id, filename)
    return jsonify({"success": True, "filename": filename, "chunks_removed": removed_chunks})


# ──────────────────────────────────────────────────────────
# Routes — File upload
# ──────────────────────────────────────────────────────────

@app.route("/api/upload", methods=["POST"])
def upload_file():
    """
    Accepts: multipart/form-data with fields:
      - file: the document
      - chat_id: UUID of the target chat
    """
    if "file" not in request.files:
        return _error("No file field in request")

    f = request.files["file"]
    chat_id = request.form.get("chat_id", "").strip()

    if not f.filename:
        return _error("Empty filename")
    if not chat_id:
        return _error("chat_id is required")
    if not db.get_chat(chat_id):
        return _error("Chat not found", 404)
    if not _allowed(f.filename):
        return _error(f"File type not supported. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")

    filename = secure_filename(f.filename)
    tmp_path = os.path.join(UPLOAD_TMP, f"{uuid.uuid4()}_{filename}")
    f.save(tmp_path)

    def generate():
        try:
            for progress_event in rag_engine.ingest_file_stream(chat_id, tmp_path, filename):
                if progress_event["status"] == "done":
                    result = progress_event["result"]
                    doc = db.add_document(
                        chat_id=chat_id,
                        filename=filename,
                        file_type=result["file_type"],
                        num_chunks=result["num_chunks"],
                        num_pages=result["num_pages"],
                    )

                    # Auto-update chat title from first document
                    chat = db.get_chat(chat_id)
                    if chat and chat["title"] == "New Chat":
                        db.update_chat_title(chat_id, Path(filename).stem[:40])

                    yield _sse({"type": "done", "document": doc})
                else:
                    yield _sse({"type": "progress", "data": progress_event})
        except Exception as e:
            yield _sse({"type": "error", "message": f"Ingestion failed: {e}"})
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    return Response(generate(), mimetype="text/event-stream")


# ──────────────────────────────────────────────────────────
# Routes — Query (SSE streaming)
# ──────────────────────────────────────────────────────────

@app.route("/api/query", methods=["POST"])
def query():
    """
    Accepts JSON: {chat_id: str, question: str}
    Returns Server-Sent Events stream:
      - {"type": "citations", "data": [...]}    — citation list first
      - {"type": "token", "data": "..."}        — LLM tokens streamed
      - {"type": "done", "full_answer": "..."}  — signals completion
      - {"type": "error", "message": "..."}     — on error
    """
    body     = request.get_json(silent=True) or {}
    chat_id  = body.get("chat_id", "").strip()
    question = body.get("question", "").strip()
    use_web_search = body.get("use_web_search", False)

    if not chat_id or not question:
        return _error("Both chat_id and question are required")
    if not db.get_chat(chat_id):
        return _error("Chat not found", 404)
    if not use_web_search and not rag_engine.has_documents(chat_id):
        return _error("No documents uploaded to this chat yet. Please upload a file first.", 400)

    def generate():
        try:
            # 1. Retrieve citations + context
            citations, context = rag_engine.query_rag(chat_id, question, use_web_search)

            if not citations and not use_web_search:
                yield _sse({"type": "error",
                            "message": "No relevant context found in documents."})
                return
                
            if use_web_search and not context:
                yield _sse({"type": "error",
                            "message": "No relevant context found in documents and web search returned no results."})
                return

            # 2. Send citations to client immediately
            yield _sse({"type": "citations", "data": citations})

            # 3. Save user message
            db.add_message(chat_id, "user", question)

            # 4. Stream LLM tokens
            full_answer = ""
            for token in rag_engine.stream_llm(context, question):
                full_answer += token
                yield _sse({"type": "token", "data": token})

            # 5. Save assistant message with citations
            db.add_message(chat_id, "assistant", full_answer, citations)

            # 6. Signal done
            yield _sse({"type": "done", "full_answer": full_answer})

        except Exception as e:
            yield _sse({"type": "error", "message": str(e)})

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ──────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import rag_engine as _re
    print("\n" + "="*60)
    print("  RAG CHAT WEB INTERFACE  —  http://localhost:5000")
    print("="*60)
    print(f"  Embedding  ({_re.EMBED_MODEL:<20})  GPU {_re.EMBED_GPU}  port {_re.EMBED_OLLAMA_PORT}")
    print(f"  LLM        ({_re.LLM_MODEL:<20})  GPU {_re.LLM_GPU}  port {_re.LLM_OLLAMA_PORT}")
    print("="*60 + "\n")
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)
