from pathlib import Path
from typing import Dict, List


SUPPORTED_SUFFIXES = {".md", ".txt", ".jsonl"}


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 120) -> List[str]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than zero")
    if overlap < 0 or overlap * 2 >= chunk_size:
        raise ValueError("overlap must be at least zero and less than half chunk_size")

    normalized = " ".join(text.split())
    if not normalized:
        return []

    chunks = []
    start = 0
    while start < len(normalized):
        end = min(start + chunk_size, len(normalized))
        if end < len(normalized):
            boundary = normalized.rfind(" ", start + chunk_size // 2, end)
            if boundary > start:
                end = boundary
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(start + 1, end - overlap)

    return chunks


def load_corpus_documents(corpus_dir: Path) -> List[Dict[str, str]]:
    if not corpus_dir.exists():
        raise FileNotFoundError("Corpus directory does not exist: {}".format(corpus_dir))

    documents = []
    for path in sorted(corpus_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_SUFFIXES:
            continue

        relative_path = path.relative_to(corpus_dir).as_posix()
        if path.suffix.lower() == ".jsonl":
            with path.open("r", encoding="utf-8") as source_file:
                for line_number, line in enumerate(source_file, start=1):
                    content = line.strip()
                    if content:
                        documents.append({
                            "source": "{}:{}".format(relative_path, line_number),
                            "text": content,
                        })
        else:
            content = path.read_text(encoding="utf-8").strip()
            if content:
                documents.append({"source": relative_path, "text": content})

    return documents


def chunk_documents(
    documents: List[Dict[str, str]],
    chunk_size: int = 800,
    overlap: int = 120,
) -> List[Dict[str, object]]:
    chunks = []
    for document in documents:
        for chunk_index, text in enumerate(
            chunk_text(document["text"], chunk_size, overlap)
        ):
            chunks.append({
                "source": document["source"],
                "chunk_index": chunk_index,
                "text": text,
            })
    return chunks
