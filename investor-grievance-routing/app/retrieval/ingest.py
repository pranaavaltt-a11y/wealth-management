"""Idempotent corpus pipeline: read -> parse -> chunk -> embed -> index (D2, L1).

    python -m app.retrieval.ingest                    # incremental: only new or changed chunks are embedded
    python -m app.retrieval.ingest --reembed RBI-IOS  # re-embed one document, leave the rest of the index alone
    python -m app.retrieval.ingest --force            # full rebuild
    python -m app.retrieval.ingest --chunking fixed   # baseline chunking, used for the before/after evaluation

Chunking strategy (why it addresses the corpus difficulty in section 3 of the brief): every chunk is a
whole clause, prefixed with a context header that names the regulator, the framework and the clause.
A complaint that uses investment words about a bank product then has to compete against the explicit
statement of which regulator each passage belongs to, and exclusion clauses carry
`excludes=` and `modifies=` metadata. The agent uses that metadata to look for provisions that change
the one it first retrieved.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import time
from pathlib import Path

from langchain_community.vectorstores import FAISS
from langchain_community.vectorstores.utils import DistanceStrategy
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.common.config import get_settings
from app.retrieval.embeddings import build_embeddings, cached_embeddings

CLAUSE_HEADING = re.compile(r"^##\s*\[(?P<id>[^\]]+)\]\s*(?P<title>.+)$", re.M)
META_COMMENT = re.compile(r"<!--\s*(?P<body>.*?)\s*-->", re.S)
PDF_HEADING = re.compile(r"^\s*(?P<num>\d{1,2}(?:\.\d{1,2})*)\.?\s+(?P<title>[A-Z][^\n]{3,80})$", re.M)


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def parse_front_matter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    _, head, body = text.split("---", 2)
    meta = {}
    for line in head.strip().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip()
    return meta, body


def parse_meta(comment: str) -> dict:
    meta: dict = {}
    for part in comment.split(";"):
        if "=" in part:
            key, value = part.split("=", 1)
            values = [v.strip() for v in value.split(",") if v.strip()]
            meta[key.strip()] = values if key.strip() in ("covers", "excludes", "modifies") else value.strip()
    return meta


def read_document(path: Path) -> dict:
    """Return {doc meta, clauses: [{clause_id, title, text, meta}]}."""
    if path.suffix.lower() == ".pdf":
        from pypdf import PdfReader

        text = "\n".join(page.extract_text() or "" for page in PdfReader(str(path)).pages)
        if len(text.strip()) < 200:
            raise ValueError(f"{path.name}: no text layer; run OCR first")
        doc_id = re.sub(r"[^A-Z0-9]+", "-", path.stem.upper()).strip("-")
        meta = {"doc_id": doc_id, "title": path.stem, "regulator": "UNKNOWN", "reference": path.name,
                "version": sha(text)[:12]}
        heads = list(PDF_HEADING.finditer(text))
        clauses = []
        for i, m in enumerate(heads or [None]):
            start = m.end() if m else 0
            end = heads[i + 1].start() if m and i + 1 < len(heads) else len(text)
            clauses.append({"clause_id": f"{doc_id}/p{m.group('num') if m else 1}",
                            "title": m.group("title").strip() if m else path.stem,
                            "text": " ".join(text[start:end].split()), "meta": {"kind": "provision"}})
        return {"meta": meta, "clauses": [c for c in clauses if len(c["text"]) > 40], "raw": text}

    raw = path.read_text(encoding="utf-8")
    meta, body = parse_front_matter(raw)
    heads = list(CLAUSE_HEADING.finditer(body))
    clauses = []
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(body)
        block = body[m.end():end]
        cm = META_COMMENT.search(block)
        clause_meta = parse_meta(cm.group("body")) if cm else {}
        text = META_COMMENT.sub("", block).strip()
        clauses.append({"clause_id": m.group("id").strip(), "title": m.group("title").strip(),
                        "text": " ".join(text.split()), "meta": clause_meta})
    return {"meta": meta, "clauses": clauses, "raw": raw}


def chunk_document(doc: dict, strategy: str) -> list[Document]:
    meta = doc["meta"]
    base = {"doc_id": meta.get("doc_id"), "document": meta.get("title"), "regulator": meta.get("regulator"),
            "reference": meta.get("reference"), "doc_version": meta.get("version")}
    out: list[Document] = []
    if strategy == "clause":
        splitter = RecursiveCharacterTextSplitter(chunk_size=1200, chunk_overlap=150)
        for clause in doc["clauses"]:
            header = (f"Regulator: {base['regulator']}. Framework: {base['document']}. "
                      f"Clause {clause['clause_id']}: {clause['title']}.")
            pieces = splitter.split_text(clause["text"]) if len(clause["text"]) > 1200 else [clause["text"]]
            for n, piece in enumerate(pieces):
                out.append(Document(page_content=f"{header}\n{piece}", metadata={
                    **base, "clause_id": clause["clause_id"], "title": clause["title"], "chunk_no": n,
                    "kind": clause["meta"].get("kind", "provision"),
                    "covers": clause["meta"].get("covers", []), "excludes": clause["meta"].get("excludes", []),
                    "modifies": clause["meta"].get("modifies", []), "passage": piece}))
    elif strategy == "fixed":
        # Baseline: fixed 400-character windows over the running text, no context header.
        spans, cursor, full = [], 0, []
        for clause in doc["clauses"]:
            full.append(clause["text"])
            spans.append((cursor, cursor + len(clause["text"]), clause))
            cursor += len(clause["text"]) + 1
        text = " ".join(full)
        for n, start in enumerate(range(0, len(text), 350)):
            piece = text[start:start + 400]
            clause = next((c for s, e, c in spans if s <= start < e), spans[-1][2])
            out.append(Document(page_content=piece, metadata={
                **base, "clause_id": clause["clause_id"], "title": clause["title"], "chunk_no": n,
                "kind": clause["meta"].get("kind", "provision"), "covers": clause["meta"].get("covers", []),
                "excludes": clause["meta"].get("excludes", []), "modifies": clause["meta"].get("modifies", []),
                "passage": piece}))
    else:
        raise ValueError(f"unknown chunking strategy {strategy!r}")
    for doc_ in out:
        doc_.metadata["chunk_id"] = sha(f"{strategy}|{doc_.metadata['clause_id']}|{doc_.metadata['chunk_no']}|"
                                        f"{doc_.page_content}")[:20]
    return out


def corpus_files(corpus_dir: Path) -> list[Path]:
    return sorted(p for p in corpus_dir.iterdir()
                  if p.suffix.lower() in (".md", ".txt", ".pdf") and p.name.upper() != "SOURCES.MD")


def build_index(corpus_dir: str, index_dir: str, chunking: str, backend: str, model: str | None,
                force: bool = False, reembed: list[str] | None = None) -> dict:
    started = time.time()
    index_path = Path(index_dir)
    manifest_path = index_path / "manifest.json"
    embeddings, model_id = build_embeddings(backend, model)
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    if old and (old["embedder"] != model_id or old["chunking"] != chunking):
        force = True  # a different embedder or chunking invalidates every vector
    if force and index_path.exists():
        shutil.rmtree(index_path / "faiss", ignore_errors=True)
    index_path.mkdir(parents=True, exist_ok=True)
    cached = cached_embeddings(embeddings, index_path / "emb_cache", model_id)

    docs_meta, all_chunks = {}, []
    for path in corpus_files(Path(corpus_dir)):
        doc = read_document(path)
        chunks = chunk_document(doc, chunking)
        docs_meta[doc["meta"]["doc_id"]] = {"file": path.name, "sha256": sha(doc["raw"]),
                                           "version": doc["meta"].get("version"), "chunks": len(chunks),
                                           "clauses": len(doc["clauses"])}
        all_chunks.extend(chunks)

    wanted = {c.metadata["chunk_id"]: c for c in all_chunks}
    store = None
    faiss_dir = index_path / "faiss"
    if faiss_dir.exists() and not force:
        store = FAISS.load_local(str(faiss_dir), cached, allow_dangerous_deserialization=True,
                                 distance_strategy=DistanceStrategy.MAX_INNER_PRODUCT)
    existing = set(store.index_to_docstore_id.values()) if store else set()
    reembed_ids = {cid for cid, c in wanted.items() if c.metadata["doc_id"] in (reembed or [])}
    to_delete = [cid for cid in existing if cid not in wanted or cid in reembed_ids]
    to_add = [c for cid, c in wanted.items() if cid not in existing or cid in reembed_ids]
    if reembed_ids:
        # bypass the embedding cache for the documents being re-embedded
        cached = embeddings
        if store:
            store.embedding_function = embeddings
    if store and to_delete:
        store.delete(to_delete)
    if to_add:
        if store is None:
            store = FAISS.from_documents(to_add, cached, ids=[c.metadata["chunk_id"] for c in to_add],
                                         distance_strategy=DistanceStrategy.MAX_INNER_PRODUCT)
        else:
            store.add_documents(to_add, ids=[c.metadata["chunk_id"] for c in to_add])
    store.save_local(str(faiss_dir))

    elapsed = max(time.time() - started, 1e-6)
    chunks_payload = {cid: {"text": c.page_content, "metadata": c.metadata} for cid, c in wanted.items()}
    (index_path / "chunks.json").write_text(json.dumps(chunks_payload, indent=1))
    manifest = {
        "index_version": sha(model_id + chunking + "".join(sorted(wanted)))[:12],
        "built_at": time.time(),
        "built_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "embedder": model_id, "chunking": chunking, "documents": docs_meta,
        "chunks_total": len(wanted), "chunks_embedded_this_run": len(to_add), "chunks_deleted_this_run": len(to_delete),
        "duration_s": round(elapsed, 3), "throughput_chunks_per_s": round(len(to_add) / elapsed, 2),
        "mode": "full" if force or old is None else ("reembed" if reembed else "incremental"),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2))
    return manifest


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--corpus", default=settings.corpus_dir)
    parser.add_argument("--index", default=settings.index_dir)
    parser.add_argument("--chunking", default=settings.chunking, choices=["clause", "fixed"])
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--reembed", nargs="*", default=[], metavar="DOC_ID")
    args = parser.parse_args()
    manifest = build_index(args.corpus, args.index, args.chunking, settings.embedding_backend,
                           settings.embedding_model, args.force, args.reembed)
    print(json.dumps({k: v for k, v in manifest.items() if k != "documents"}, indent=2))
    pushgateway = os.getenv("PUSHGATEWAY_URL")
    if pushgateway:  # optional; the API and workers also expose index freshness from the manifest
        from prometheus_client import CollectorRegistry, Gauge, push_to_gateway

        reg = CollectorRegistry()
        Gauge("igr_ingest_chunks_per_second", "", registry=reg).set(manifest["throughput_chunks_per_s"])
        push_to_gateway(pushgateway, job="indexer", registry=reg)


if __name__ == "__main__":
    main()
