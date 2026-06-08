# RAG Chat Web Application

This repository provides a powerful, responsive Web UI for chatting with documents (PDF, HTML, TXT, DOCX), powered by local **Ollama** embeddings and LLMs.

## Prerequisites

- **Python 3.10+**
- **Ollama** installed on your system (see [ollama.com](https://ollama.com)).
- Two local Ollama instances running on separate ports/GPUs (detailed below).

## Required Ollama Models

The agent uses two models:
1. **Embedding model**: `qwen3-embedding`
2. **LLM model**: `gemma3:latest`

Pull them once (or after updating):
```bash
ollama pull qwen3-embedding
ollama pull gemma3:latest
```

## Running the Ollama Servers (Multi-GPU)

To ensure the backend works blazingly fast, the web app routes embedding tasks to **GPU 0** and heavy LLM generation tasks to **GPU 1**. You must start two separate Ollama instances with the correct permissions.

Open **two separate PowerShell windows** and run the following commands:

**Terminal 1 (Embeddings on GPU 0):**
```powershell
$env:CUDA_VISIBLE_DEVICES="0"
$env:OLLAMA_HOST="0.0.0.0:11434"
$env:OLLAMA_ORIGINS="*"
ollama serve
```

**Terminal 2 (Gemma LLM on GPU 1):**
```powershell
$env:CUDA_VISIBLE_DEVICES="1"
$env:OLLAMA_HOST="0.0.0.0:11435"
$env:OLLAMA_ORIGINS="*"
ollama serve
```

*(Note: `OLLAMA_ORIGINS="*"` ensures no CORS restrictions block the UI, and `CUDA_VISIBLE_DEVICES` correctly locks Ollama onto the specific GPU).*

## Starting the Web Interface

```bash
# 1. Activate your virtual environment
.\.venv\Scripts\activate

# 2. Install dependencies (if you haven't)
pip install -r requirements.txt

# 3. Start the Flask application
python .\app.py
```

Now open `http://localhost:5000` in your web browser!

## Features included
- **Responsive 3D Design**: Looks amazing on Desktop, Tablet, and Mobile devices.
- **Fast Generation**: Gemma generation is optimized with bounded context (`num_ctx`) and kept in GPU memory (`keep_alive`) for zero latency on subsequent questions.
- **Cancel Generation**: Integrated a Stop button to immediately halt streaming text.
- **Chat History & Sidebar**: Manage multiple conversations easily.
