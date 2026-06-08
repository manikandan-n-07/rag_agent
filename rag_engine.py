"""
rag_engine.py — Core RAG logic: file ingestion, embedding, FAISS search, LLM query.

Supports: PDF, HTML, TXT, DOCX
Each chat session gets its own FAISS index under vector_store/<chat_id>/
"""

import os
import json
import pickle
import subprocess
import time
import socket
import urllib.request
import re
from pathlib import Path

import numpy as np
import faiss
from langchain_text_splitters import RecursiveCharacterTextSplitter

# ──────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────
EMBED_MODEL = "qwen3-embedding"
LLM_MODEL   = "gemma3:latest"
TOP_K       = 5
CHUNK_SIZE  = 500
CHUNK_OVERLAP = 100
VECTOR_STORE_ROOT = os.path.join(os.path.dirname(__file__), "vector_store")

# ── Per-model Ollama server config ─────────────────────────
# Embedding model → GPU 0, port 11434
EMBED_OLLAMA_HOST = "http://localhost:11434"
EMBED_GPU         = "0"          # CUDA device index for qwen3-embedding

# LLM model      → GPU 1, port 11435
LLM_OLLAMA_HOST   = "http://localhost:11435"
LLM_GPU           = "1"          # CUDA device index for gemma3

LLM_OLLAMA_PORT   = 11435
EMBED_OLLAMA_PORT = 11434

SYSTEM_PROMPT = """You are an expert Document Analysis Assistant with deep knowledge retrieval capabilities.

Rules:
- Answer using BOTH the provided document context and the web search context below (if available).
- You may synthesize information from both contexts. Do NOT invent or hallucinate facts.
- You MUST provide a highly detailed, step-by-step answer. Draft the answer such that all steps involved are thoroughly detailed and explained.
- Provide detailed, well-structured answers with clear formatting.
- When referencing specific facts, naturally mention which document or web source they come from.
- If the context contains numerical data, statistics, or equations, format them clearly.
- Use inline math $...$ for equations or $$...$$ for block formulas when relevant.
- If information is not in the provided contexts, reply: "I could not find that information in the provided context."
- Be comprehensive but concise. Structure longer answers with bullet points or numbered lists."""

# ──────────────────────────────────────────────────────────
# Ollama helpers — dual-server GPU routing
# ──────────────────────────────────────────────────────────

def _is_port_open(port: int) -> bool:
    """Return True if an Ollama server is already listening on 'port'."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        s.connect(("127.0.0.1", port))
        s.close()
        return True
    except Exception:
        return False


def _start_ollama_on(port: int, gpu_id: str, wait: int = 6) -> None:
    """
    Launch a new `ollama serve` process bound to 'port' on 'gpu_id'.
    Ollama uses OLLAMA_HOST to choose its listen address and
    CUDA_VISIBLE_DEVICES to pick the GPU.
    """
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = gpu_id
    env["OLLAMA_HOST"]          = f"0.0.0.0:{port}"
    subprocess.Popen(
        ["ollama", "serve"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"[GPU-routing] Starting Ollama on GPU {gpu_id} at port {port}…")
    time.sleep(wait)


def _ensure_embed_server() -> None:
    """Guarantee the embedding Ollama server (GPU 0, port 11434) is running."""
    if not _is_port_open(EMBED_OLLAMA_PORT):
        _start_ollama_on(EMBED_OLLAMA_PORT, EMBED_GPU)


def _ensure_llm_server() -> None:
    """Guarantee the LLM Ollama server (GPU 2, port 11435) is running."""
    if not _is_port_open(LLM_OLLAMA_PORT):
        _start_ollama_on(LLM_OLLAMA_PORT, LLM_GPU)


def _ollama_post(url: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ──────────────────────────────────────────────────────────
# Embedding  →  GPU 0  (port 11434)
# ──────────────────────────────────────────────────────────

def get_embedding(text: str) -> np.ndarray:
    _ensure_embed_server()
    payload = {"model": EMBED_MODEL, "input": text, "keep_alive": "1h"}
    try:
        result = _ollama_post(f"{EMBED_OLLAMA_HOST}/api/embed", payload)
        vec = result.get("embeddings", [result.get("embedding")])[0]
    except Exception:
        # Fallback to legacy endpoint
        payload2 = {"model": EMBED_MODEL, "prompt": text, "keep_alive": "1h"}
        result = _ollama_post(f"{EMBED_OLLAMA_HOST}/api/embeddings", payload2)
        vec = result["embedding"]
    return np.array(vec, dtype=np.float32)


def get_embeddings_batch(texts: list[str]) -> np.ndarray:
    """Embed a list of texts in sequence, returns shape (N, D)."""
    _ensure_embed_server()
    vecs = [get_embedding(t) for t in texts]
    return np.array(vecs, dtype=np.float32)


# ──────────────────────────────────────────────────────────
# LLM streaming  →  GPU 1  (port 11435)
# ──────────────────────────────────────────────────────────

def stream_llm(context: str, question: str):
    """Generator that yields text tokens from Ollama streaming chat (GPU 1)."""
    _ensure_llm_server()
    user_msg = f"Document Context:\n{context}\n\nUser Question:\n{question}"
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": user_msg},
        ],
        "stream": True,
        "keep_alive": "1h",  # Keep model in GPU memory for faster subsequent queries
        "options": {
            "temperature": 0.1, 
            "top_p": 0.85,
            "num_ctx": 4096,     # Limit context window to speed up generation
            "num_predict": 1024  # Prevent infinite generation loops
        },
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{LLM_OLLAMA_HOST}/api/chat",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        for raw_line in resp:
            if not raw_line:
                continue
            try:
                fragment = json.loads(raw_line.decode("utf-8"))
                if fragment.get("done"):
                    break
                token = fragment.get("message", {}).get("content", "")
                if token:
                    yield token
            except Exception:
                continue


# ──────────────────────────────────────────────────────────
# File extraction
# ──────────────────────────────────────────────────────────

def extract_text_pdf(filepath: str) -> list[dict]:
    """Returns list of {page: int, text: str}"""
    import fitz
    doc = fitz.open(filepath)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text("text", sort=True).strip()
        if text:
            pages.append({"page": i + 1, "text": text})
    return pages


def extract_text_html(filepath: str) -> list[dict]:
    """Parse HTML and return as a single pseudo-page."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        # Fallback: strip tags with regex
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            raw = f.read()
        text = re.sub(r"<[^>]+>", " ", raw)
        text = re.sub(r"\s+", " ", text).strip()
        return [{"page": 1, "text": text}]

    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        soup = BeautifulSoup(f, "html.parser")
    # Remove scripts/styles
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    return [{"page": 1, "text": text}]


def extract_text_docx(filepath: str) -> list[dict]:
    try:
        import docx
        doc = docx.Document(filepath)
        text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        return [{"page": 1, "text": text}]
    except Exception as e:
        return [{"page": 1, "text": f"[Could not read DOCX: {e}]"}]


def extract_text_txt(filepath: str) -> list[dict]:
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    return [{"page": 1, "text": text}]


def extract_text(filepath: str) -> tuple[list[dict], str]:
    """
    Auto-detect file type and extract text.
    Returns (pages, file_type)
    """
    ext = Path(filepath).suffix.lower()
    if ext == ".pdf":
        return extract_text_pdf(filepath), "pdf"
    elif ext in (".html", ".htm"):
        return extract_text_html(filepath), "html"
    elif ext in (".docx",):
        return extract_text_docx(filepath), "docx"
    else:
        return extract_text_txt(filepath), "txt"


# ──────────────────────────────────────────────────────────
# Per-chat FAISS index management
# ──────────────────────────────────────────────────────────

def _chat_store_dir(chat_id: str) -> str:
    path = os.path.join(VECTOR_STORE_ROOT, chat_id)
    os.makedirs(path, exist_ok=True)
    return path


def _index_path(chat_id: str) -> str:
    return os.path.join(_chat_store_dir(chat_id), "faiss.index")


def _chunks_path(chat_id: str) -> str:
    return os.path.join(_chat_store_dir(chat_id), "chunks.pkl")


def _load_store(chat_id: str):
    """Returns (faiss_index or None, chunks_list)."""
    ip = _index_path(chat_id)
    cp = _chunks_path(chat_id)
    if os.path.exists(ip) and os.path.exists(cp):
        idx = faiss.read_index(ip)
        with open(cp, "rb") as f:
            chunks = pickle.load(f)
        return idx, chunks
    return None, []


def _save_store(chat_id: str, index, chunks: list):
    faiss.write_index(index, _index_path(chat_id))
    with open(_chunks_path(chat_id), "wb") as f:
        pickle.dump(chunks, f)


# ──────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────

def ingest_file_stream(chat_id: str, filepath: str, filename: str):
    """
    Extract, chunk, embed, and add a file's contents to the chat's FAISS index.
    Yields progress dicts. Finally yields status='done'.
    """
    yield {"status": "extracting", "message": f"Extracting text from {filename}..."}
    pages, file_type = extract_text(filepath)
    num_pages = len(pages)

    yield {"status": "chunking", "message": "Splitting text into chunks..."}
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", " ", ""],
    )

    new_chunks = []
    for page_info in pages:
        page_num = page_info["page"]
        page_text = page_info["text"]
        sub_chunks = splitter.split_text(page_text)
        for chunk_text in sub_chunks:
            new_chunks.append({
                "text": chunk_text,
                "source": filename,
                "page": page_num,
                "file_type": file_type,
            })

    total_chunks = len(new_chunks)
    if total_chunks == 0:
        yield {"status": "done", "result": {"num_chunks": 0, "num_pages": num_pages, "file_type": file_type}}
        return

    # Embed all new chunks iteratively
    _ensure_embed_server()
    new_embeddings_list = []
    texts_to_embed = [c["text"] for c in new_chunks]
    
    for i, t in enumerate(texts_to_embed):
        yield {
            "status": "embedding", 
            "message": f"Embedding chunk {i+1} of {total_chunks}...", 
            "progress": (i+1)/total_chunks
        }
        new_embeddings_list.append(get_embedding(t))

    yield {"status": "saving", "message": "Saving vectors to database..."}
    new_embeddings = np.array(new_embeddings_list, dtype=np.float32)

    # Load existing index or create new
    index, existing_chunks = _load_store(chat_id)

    if index is None:
        dim = new_embeddings.shape[1]
        index = faiss.IndexFlatL2(dim)

    index.add(new_embeddings)
    all_chunks = existing_chunks + new_chunks
    _save_store(chat_id, index, all_chunks)

    yield {"status": "done", "result": {
        "num_chunks": total_chunks,
        "num_pages": num_pages,
        "file_type": file_type,
    }}


def perform_web_search(query: str) -> str:
    """Perform a web search using DuckDuckGo and return a summarized context string."""
    try:
        from ddgs import DDGS
        results = DDGS().text(query, max_results=3)
            
        if not results:
            return ""
        
        web_context = "[WEB SEARCH RESULTS]\n"
        for r in results:
            web_context += f"- Source: {r.get('href')}\n  Snippet: {r.get('body')}\n\n"
        return web_context
    except Exception as e:
        print(f"Web search error: {e}")
        return ""


def query_rag(chat_id: str, question: str, use_web_search: bool = False) -> tuple[list[dict], str]:
    """
    Search the chat's FAISS index and generate a streaming-ready response.

    Returns:
        citations: list of {source, page, text, score} dicts
        context:   the assembled context string passed to LLM
    """
    index, chunks = _load_store(chat_id)
    
    citations = []
    context_parts = []
    
    if index is not None and chunks:
        # Embed question
        search_text = "represent this sentence for searching relevant passages: " + question
        q_vec = get_embedding(search_text)
        q_vec = np.array([q_vec], dtype=np.float32)

        k = min(TOP_K, len(chunks))
        distances, indices = index.search(q_vec, k)

        seen_texts = set()

        for dist, idx in zip(distances[0], indices[0]):
            if idx < 0 or idx >= len(chunks):
                continue
            chunk = chunks[idx]
            chunk_text = chunk["text"]
            if chunk_text in seen_texts:
                continue
            seen_texts.add(chunk_text)

            score = float(1 / (1 + dist))  # Convert L2 distance to similarity score
            citations.append({
                "source": chunk["source"],
                "page": chunk["page"],
                "text": chunk_text[:400],  # Quoted snippet (truncated for display)
                "score": round(score, 4),
                "file_type": chunk.get("file_type", "unknown"),
            })
            context_parts.append(
                f"[Source: {chunk['source']} | Page {chunk['page']}]\n{chunk_text}"
            )

    context = "\n\n---\n\n".join(context_parts)
    
    if use_web_search:
        web_ctx = perform_web_search(question)
        if web_ctx:
            if context:
                context = f"{web_ctx}\n\n---\n\n[DOCUMENT CONTEXT]\n{context}"
            else:
                context = web_ctx

    return citations, context


def has_documents(chat_id: str) -> bool:
    """Check whether a chat session has any indexed documents."""
    return os.path.exists(_index_path(chat_id))


def remove_document_from_index(chat_id: str, filename: str) -> int:
    """
    Remove all chunks belonging to 'filename' from the chat's FAISS index
    by rebuilding it without those chunks.
    Returns the number of chunks removed.
    """
    index, chunks = _load_store(chat_id)
    if index is None or not chunks:
        return 0

    remaining = [c for c in chunks if c["source"] != filename]
    removed   = len(chunks) - len(remaining)

    if not remaining:
        # No docs left — delete the store entirely
        import shutil
        shutil.rmtree(_chat_store_dir(chat_id), ignore_errors=True)
        return removed

    # Re-embed remaining chunks and rebuild index
    texts = [c["text"] for c in remaining]
    vecs  = get_embeddings_batch(texts)
    dim   = vecs.shape[1]
    new_index = faiss.IndexFlatL2(dim)
    new_index.add(vecs)
    _save_store(chat_id, new_index, remaining)
    return removed
