# RAG Agent — Document Chat Web App

A fully local, GPU-accelerated **Retrieval-Augmented Generation (RAG)** web application for chatting with your documents. Upload PDFs, HTML, DOCX, or TXT files and get detailed, cited answers powered by local **Ollama** models — no cloud API keys required.

---

## ✨ Features

- **Multi-format document ingestion** — PDF, HTML, DOCX, TXT, and Markdown
- **Local-first AI** — Runs entirely on your machine via Ollama (no data leaves your system)
- **Dual-GPU routing** — Embedding model on GPU 0, LLM on GPU 1 for maximum throughput
- **FAISS vector search** — Per-session FAISS indexes for fast semantic retrieval
- **Streaming responses** — Server-Sent Events (SSE) for real-time token streaming
- **Stop generation** — Cancel in-flight LLM responses instantly
- **Web search augmentation** — Enriches answers with live web context via DuckDuckGo
- **Chat history & sessions** — Multiple independent conversations with SQLite persistence
- **Responsive 3D UI** — Polished interface that works on Desktop, Tablet, and Mobile
- **Math rendering** — Inline `$...$` and block `$$...$$` LaTeX equation support
- **CLI tools** — Standalone `build_index.py` and `search_query.py` for headless/batch usage

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.10+, Flask |
| Embeddings | Ollama (`qwen3-embedding`) |
| LLM | Ollama (`gemma3:latest`) |
| Vector Store | FAISS (per-session) |
| Text Splitting | LangChain `RecursiveCharacterTextSplitter` |
| PDF Parsing | PyMuPDF (`fitz`) |
| Database | SQLite (via `db.py`) |
| Web Search | DuckDuckGo Search (`ddgs`) |
| Frontend | Vanilla JS + CSS (no framework) |

---

## 📋 Prerequisites

- **Python 3.10+**
- **Ollama** installed — [ollama.com](https://ollama.com)
- A machine with **2 NVIDIA GPUs** (recommended) or a single GPU / CPU (slower)

---

## 🚀 Quick Start

### 1. Pull the required Ollama models

```bash
ollama pull qwen3-embedding
ollama pull gemma3:latest
```

### 2. Start two Ollama servers (Multi-GPU)

The app routes embedding tasks to **GPU 0** (port `11434`) and LLM generation to **GPU 1** (port `11435`).

**Terminal 1 — Embeddings on GPU 0:**
```powershell
$env:CUDA_VISIBLE_DEVICES="0"
$env:OLLAMA_HOST="0.0.0.0:11434"
$env:OLLAMA_ORIGINS="*"
ollama serve
```

**Terminal 2 — LLM on GPU 1:**
```powershell
$env:CUDA_VISIBLE_DEVICES="1"
$env:OLLAMA_HOST="0.0.0.0:11435"
$env:OLLAMA_ORIGINS="*"
ollama serve
```

> **Single GPU?** Run one Ollama instance on port `11434` and update both `EMBED_OLLAMA_HOST` and `LLM_OLLAMA_HOST` in `rag_engine.py` to point to the same server.

### 3. Install dependencies

```bash
python -m venv .venv
# Windows
.\.venv\Scripts\activate
# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt
```

### 4. Launch the web app

```bash
python app.py
```

Open **http://localhost:5000** in your browser.

---

## 📁 Project Structure

```
rag_agent/
├── app.py                  # Flask REST API & SSE streaming
├── rag_engine.py           # Core RAG logic: ingestion, FAISS, LLM query
├── db.py                   # SQLite session/message/document persistence
├── requirements.txt        # Python dependencies
├── commnds_for_GPU.md      # Quick-reference GPU startup commands
├── agent_cli/
│   ├── build_index.py      # CLI: batch-index a folder of PDFs
│   └── search_query.py     # CLI: query the built index from the terminal
├── templates/
│   └── index.html          # Single-page web UI
└── static/
    ├── app.js              # Frontend logic (chat, upload, SSE)
    └── style.css           # 3D responsive styling
```

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/chat/new` | Create a new chat session |
| `GET` | `/api/chats` | List all chat sessions |
| `GET` | `/api/chat/<id>` | Get chat details |
| `GET` | `/api/chat/<id>/history` | Retrieve full message history |
| `GET` | `/api/chat/<id>/documents` | List documents uploaded to a chat |
| `POST` | `/api/upload` | Upload a document into a chat session |
| `POST` | `/api/query` | Ask a question (SSE streaming response) |

---

## 🖥 CLI Usage

For headless or batch workflows, use the standalone CLI tools in `agent_cli/`.

**Build a FAISS index from a folder of PDFs:**
```bash
# Place your PDFs in the `documents/` folder, then:
python agent_cli/build_index.py
```

**Query the index from the terminal:**
```bash
python agent_cli/search_query.py
```

---

## ⚙️ Configuration

Key constants in `rag_engine.py`:

| Variable | Default | Description |
|---|---|---|
| `EMBED_MODEL` | `qwen3-embedding` | Ollama embedding model |
| `LLM_MODEL` | `gemma3:latest` | Ollama LLM model |
| `TOP_K` | `5` | Number of retrieved chunks per query |
| `CHUNK_SIZE` | `500` | Token chunk size for text splitting |
| `CHUNK_OVERLAP` | `100` | Overlap between consecutive chunks |
| `EMBED_OLLAMA_HOST` | `http://localhost:11434` | Embedding server URL |
| `LLM_OLLAMA_HOST` | `http://localhost:11435` | LLM server URL |

---

## 📦 Dependencies

```
pymupdf          # PDF parsing
langchain        # RAG utilities
langchain-text-splitters
faiss-cpu        # Vector similarity search
numpy
tqdm
flask            # Web server
werkzeug
beautifulsoup4   # HTML parsing
python-docx      # DOCX parsing
ddgs             # DuckDuckGo web search
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push and open a Pull Request

---

