"""Embedding backends behind LangChain's Embeddings interface.

* `sentence-transformers` runs the model named in EMBEDDING_MODEL locally (the course suggests
  all-MiniLM-L6-v2). This needs the optional torch install (see Dockerfile build arg).
* `hash` is a dependency-free, offline embedder: signed feature hashing of word unigrams and bigrams
  with sub-linear term frequency. It is weaker semantically, but deterministic and needs no download.
  It is what the test suite and the committed evaluation results use (see docs/REPORT.md).

The backend that built an index is recorded in the index manifest, and queries always use that one.
"""
from __future__ import annotations

import hashlib
import math
import re

import numpy as np
from langchain_core.embeddings import Embeddings

TOKEN = re.compile(r"[a-z0-9]+")
STOP = set("""a an about the of to in on for and or by with at from is are was were be been this that these those it its
as any such shall may which who whom whose not no under within into than then there their them they i my me we our
you your has have had do does did can will would should could also other""".split())


def tokens(text: str) -> list[str]:
    return [t for t in TOKEN.findall(text.lower()) if t not in STOP]


def _stem(tok: str) -> str:
    for suffix in ("ations", "ation", "ings", "ing", "ies", "es", "s", "ed"):
        if len(tok) > len(suffix) + 3 and tok.endswith(suffix):
            return tok[: -len(suffix)]
    return tok


class HashEmbeddings(Embeddings):
    def __init__(self, dim: int = 768):
        self.dim = dim

    @property
    def model_id(self) -> str:
        return f"hash-uni-bi-{self.dim}"

    def _vec(self, text: str) -> list[float]:
        toks = [_stem(t) for t in tokens(text)]
        feats = toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:])]
        counts: dict[str, int] = {}
        for f in feats:
            counts[f] = counts.get(f, 0) + 1
        v = np.zeros(self.dim, dtype=np.float32)
        for f, c in counts.items():
            h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "little")
            weight = (1.0 + math.log(c)) * (1.5 if "_" in f else 1.0)
            v[h % self.dim] += weight if (h >> 63) & 1 else -weight
        norm = float(np.linalg.norm(v)) or 1.0
        return (v / norm).tolist()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text)


def build_embeddings(backend: str, model: str | None) -> tuple[Embeddings, str]:
    """Return (embeddings, model_id)."""
    if backend == "sentence-transformers":
        if not model:
            raise ValueError("EMBEDDING_MODEL must be set for the sentence-transformers backend")
        from langchain_community.embeddings import HuggingFaceEmbeddings

        emb = HuggingFaceEmbeddings(model_name=model, encode_kwargs={"normalize_embeddings": True})
        return emb, f"st:{model}"
    if backend == "hash":
        emb = HashEmbeddings()
        return emb, emb.model_id
    raise ValueError(f"unknown EMBEDDING_BACKEND {backend!r}")


class FileCachedEmbeddings(Embeddings):
    """Content-addressed embedding cache (D7): unchanged chunks are never embedded twice."""

    def __init__(self, inner: Embeddings, cache_dir, namespace: str):
        from pathlib import Path

        self.inner = inner
        self.dir = Path(cache_dir) / hashlib.sha1(namespace.encode()).hexdigest()[:12]
        self.dir.mkdir(parents=True, exist_ok=True)
        self.hits = 0
        self.misses = 0

    def _path(self, text: str):
        return self.dir / (hashlib.sha256(text.encode()).hexdigest() + ".npy")

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        out: list = [None] * len(texts)
        missing = []
        for i, text in enumerate(texts):
            p = self._path(text)
            if p.exists():
                out[i] = np.load(p).tolist()
                self.hits += 1
            else:
                missing.append(i)
        if missing:
            self.misses += len(missing)
            vectors = self.inner.embed_documents([texts[i] for i in missing])
            for i, v in zip(missing, vectors):
                np.save(self._path(texts[i]), np.asarray(v, dtype=np.float32))
                out[i] = v
        return out

    def embed_query(self, text: str) -> list[float]:
        return self.inner.embed_query(text)


def cached_embeddings(inner: Embeddings, cache_dir, namespace: str) -> Embeddings:
    return FileCachedEmbeddings(inner, cache_dir, namespace)
