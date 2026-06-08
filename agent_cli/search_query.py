import os
import faiss
import pickle
import numpy as np
import urllib.request
import json
import subprocess
import time

# ==========================================
# CONFIGURATION
# ==========================================
os.environ["OLLAMA_GPU"] = "1"
os.environ["CUDA_VISIBLE_DEVICES"] = "0,1"
INDEX_PATH = "vector_store/faiss.index"
CHUNKS_PATH = "vector_store/chunks.pkl"
EMBED_MODEL_NAME = "qwen3-embedding"  # Ollama model: run 'ollama pull qwen3-embedding'
LLM_MODEL_NAME = "gemma3:latest"

TOP_K = 3  # Pulls the top 5 most highly relevant context windows matching the user math/command

# ==========================================
# LOAD VECTOR DATABASE & METADATA TRACKING
# ==========================================
print("\n[1/4] Loading FAISS Index Store...")
if not os.path.exists(INDEX_PATH) or not os.path.exists(CHUNKS_PATH):
    print("[-] Error: Missing localized database files. Please run 'build_index.py' first.")
    exit()

index = faiss.read_index(INDEX_PATH)

print("[2/4] Loading Persistent Chunks Mapping Array...")
with open(CHUNKS_PATH, "rb") as f:
    chunks = pickle.load(f)

print(f"[+] Vector Database Active. Total indexed passages: {len(chunks)}")

# ==========================================
# SETUP EMBEDDING & OLLAMA API CALLS
# ==========================================
print(f"\n[3/4] Using Ollama Embedding Model ({EMBED_MODEL_NAME})...")
print("      Make sure you have run: ollama pull qwen3-embedding")

def _ensure_ollama_running():
    """Start Ollama server with both GPUs if it is not already running.
    The server runs in the background; we give it a short warm‑up time.
    """
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        s.connect(("127.0.0.1", 11434))
        s.close()
    except Exception:
        env = os.environ.copy()
        env["CUDA_VISIBLE_DEVICES"] = "0,1"
        subprocess.Popen(["ollama", "serve"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(5)

def get_ollama_embedding(text):
    url = "http://localhost:11434/api/embeddings"
    data = {"model": EMBED_MODEL_NAME, "prompt": text}
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode('utf-8'))
        return np.array(result['embedding'], dtype=np.float32)

print(f"[4/4] Using Local Ollama LLM Engine (Model: {LLM_MODEL_NAME})...")
system_msg = """You are an expert HR and Technical Recruitment Assistant.

Rules:
- Extract and answer based ONLY on the provided Context (resumes).
- Do NOT use outside knowledge, and do NOT extrapolate.
- Provide clear, structured, and concise summaries of candidates' skills, experience, and names.
- If the answer contains mathematics, statistics, equations, or variables (like sums, sectors), you MUST format them using correct, clean LaTeX layout code notation.
- Use inline LaTeX like $...$ for equations or variables inside sentences.
- Use block style LaTeX text code wrapping like $$...$$ on its own isolated line for major formulas or calculations.
- Strict limit: Maximum 5 sentences.
- If the answer is not present in the provided text context, reply exactly and verbatim:
I could not find that information in the document."""

def query_ollama(context, question, model=LLM_MODEL_NAME):
    url = "http://localhost:11434/api/chat"
    user_msg = f"Context:\n{context}\n\nQuestion:\n{question}"
    data = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user",   "content": user_msg}
        ],
        "stream": True,
        "options": {
            "temperature": 0.1,
            "top_p": 0.8
        }
    }
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as response:
            for line in response:
                if not line:
                    continue
                fragment = json.loads(line.decode('utf-8'))
                content = fragment.get('message', {}).get('content')
                if content:
                    print(content, end='', flush=True)
        print()
    except Exception as e:
        print(f"Error communicating with Ollama: {e}")

print("\n=======================================================")
print("RESUME SHORTLISTING AGENT ONLINE (Type 'exit' to stop)")
print("=======================================================\n")

# ==========================================
# INTERACTIVE CONSOLE CONVERSATION LOOP
# ==========================================
while True:
    query = input("Ask a question about candidates (skills, names, experience): ").strip()

    if not query:
        continue

    if query.lower() == "exit":
        print("\nExiting agent session. Goodbye!")
        break

    search_query = "represent this sentence for searching relevant passages: " + query

    # Start Ollama before any embedding calls
    _ensure_ollama_running()
    
    # Generate the embedding query vector via Ollama
    query_embedding = get_ollama_embedding(search_query)
    query_embedding = np.array([query_embedding], dtype=np.float32)

    # Search FAISS matrix index
    distances, indices = index.search(query_embedding, TOP_K)

    context_parts = []
    for idx in indices[0]:
        if idx < len(chunks):
            context_parts.append(chunks[idx])

    context = "\n\n".join(context_parts)

    print("\n[Thinking] Retrieving from Document Store and Synthesizing Response...")

    # Execute inference via Ollama
    answer = query_ollama(context, query)

    print("\n" + "=" * 80)
    print("AI FACTUAL RESPONSE")
    print("=" * 80)
    print(answer)
    print("=" * 80 + "\n")
