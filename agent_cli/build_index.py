import os
import subprocess
import time
import pickle
import fitz  # PyMuPDF
import numpy as np
from tqdm import tqdm
import urllib.request
import json
from langchain_text_splitters import RecursiveCharacterTextSplitter
# =================================================
# CONFIGURATION & FILE PATHS
# =================================================
DOCS_DIR = "documents"
INDEX_PATH = "vector_store/faiss.index"
CHUNKS_PATH = "vector_store/chunks.pkl"
MODEL_NAME = "qwen3-embedding"

# Enable GPU for Ollama (if available)
os.environ["OLLAMA_GPU"] = "1"
os.environ["CUDA_VISIBLE_DEVICES"] = "0,1"
os.makedirs("vector_store", exist_ok=True)
os.makedirs(DOCS_DIR, exist_ok=True)

print("\n" + "="*50)
print("RESUME SHORTLISTING INDEX BUILDER")
print("="*50 + "\n")

# =================================================
# STEP 1: Scan Directory and Extract Layout Sorted Text
# =================================================
print("[1/6] Scanning documents directory for PDF manuals...")
pdf_files = [f for f in os.listdir(DOCS_DIR) if f.lower().endswith('.pdf')]

if not pdf_files:
    print(f"[-] Error: No PDF documents found inside '{DOCS_DIR}/'.")
    print(f"Please place your PDF manuals there and restart.")
    exit()

print(f"[+] Found {len(pdf_files)} target file(s): {pdf_files}")

all_chunks = []

# Balanced splitting window
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=100,
    separators=["\n\n", "\n", " ", ""]
)

for pdf_file in pdf_files:
    file_path = os.path.join(DOCS_DIR, pdf_file)
    print(f"\n[-->] Extracting & Parsing: {pdf_file}")
    
    doc = fitz.open(file_path)
    file_text = ""
    
    for page_num in tqdm(range(len(doc)), desc="Parsing Pages Safely"):
        page = doc.load_page(page_num)
        page_text = page.get_text("text", sort=True)
        file_text += page_text
        
    file_chunks = splitter.split_text(file_text)
    
    for chunk in file_chunks:
        tagged_chunk = f"[Source Document: {pdf_file}]\n{chunk}"
        all_chunks.append(tagged_chunk)

print(f"\n[2/6] Total Combined Chunks Created: {len(all_chunks)}")

# =================================================
# STEP 3: Setup Ollama Embeddings API
# =================================================
print(f"\n[3/6] Connecting to Local Ollama Vector Matrix (Model: {MODEL_NAME})...")

def _ensure_ollama_running():
    """Start Ollama server with both GPUs if not already running."""
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

# =================================================
# STEP 4: Generate Dense Embeddings via Ollama
# =================================================
print("\n[4/6] Generating Embeddings in Batches via Ollama...\n")

batch_size = 32
all_embeddings = []

for i in tqdm(range(0, len(all_chunks), batch_size), desc="Ollama Embedding Progress"):
    batch_texts = all_chunks[i:i+batch_size]
    # Ensure Ollama is running on both GPUs
    _ensure_ollama_running()
    batch_vectors = get_ollama_embeddings(batch_texts, MODEL_NAME)

embeddings = np.array(all_embeddings, dtype=np.float32)
print("\nEmbeddings Array Shape :", embeddings.shape)

# =================================================
# STEP 5: Building FAISS Index
# =================================================
print("\n[5/6] Building FAISS Index Matrix...")
dimension = embeddings.shape[1]

# Flat L2 performs exact, uncompressed Euclidean space retrieval
index = faiss.IndexFlatL2(dimension)
index.add(embeddings)
print(f"[+] Successfully indexed {index.ntotal} dense vectors.")

# =================================================
# STEP 6: Saving Files
# =================================================
print("\n[6/6] Flushing data securely to persistent storage...")
faiss.write_index(index, INDEX_PATH)

with open(CHUNKS_PATH, "wb") as f:
    pickle.dump(all_chunks, f)

print("\n" + "="*40)
print("INDEXATION COMPLETE")
print("="*40)
print(f"Index Store:   {INDEX_PATH}")
print(f"Chunks Store:  {CHUNKS_PATH}")
print("="*40 + "\n")
