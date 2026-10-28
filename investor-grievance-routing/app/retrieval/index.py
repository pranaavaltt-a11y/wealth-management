"""Query-time access to the corpus index: hybrid dense + BM25 search, clause lookup, and modifier lookup."""
from __future__ import annotations

import json
import math
import threading
from collections import Counter
from functools import lru_cache
from pathlib import Path

from langchain_community.vectorstores import FAISS
from langchain_community.vectorstores.utils import DistanceStrategy

from app.common import metrics
from app.common.config import get_settings
from app.retrieval.embeddings import HashEmbeddings, _stem, build_embeddings, tokens


class CorpusIndex:
    def __init__(self, index_dir: str):
        self.dir = Path(index_dir)
        self.manifest = json.loads((self.dir / "manifest.json").read_text())
        self.chunks: dict[str, dict] = json.loads((self.dir / "chunks.json").read_text())
        embedder = self.manifest["embedder"]
        if embedder.startswith("st:"):
            self.embeddings, _ = build_embeddings("sentence-transformers", embedder[3:])
        else:
            self.embeddings = HashEmbeddings()
        self.store = FAISS.load_local(str(self.dir / "faiss"), self.embeddings, allow_dangerous_deserialization=True,
                                      distance_strategy=DistanceStrategy.MAX_INNER_PRODUCT)
        self._build_bm25()
        metrics.INDEX_BUILT_AT.set(self.manifest["built_at"])
        metrics.INDEX_CHUNKS.set(self.manifest["chunks_total"])
        metrics.INDEX_DOCS.set(len(self.manifest["documents"]))
        metrics.INGEST_THROUGHPUT.set(self.manifest.get("throughput_chunks_per_s", 0))

    @property
    def version(self) -> str:
        return self.manifest["index_version"]

    # --- lexical side --------------------------------------------------------------------------------
    def _build_bm25(self) -> None:
        self._tf = {}
        df: Counter = Counter()
        for cid, chunk in self.chunks.items():
            terms = [_stem(t) for t in tokens(chunk["text"])]
            self._tf[cid] = (Counter(terms), len(terms))
            df.update(set(terms))
        n = max(len(self.chunks), 1)
        self._idf = {t: math.log(1 + (n - d + 0.5) / (d + 0.5)) for t, d in df.items()}
        self._avgdl = sum(length for _, length in self._tf.values()) / n

    def _bm25(self, query: str) -> dict[str, float]:
        q = [_stem(t) for t in tokens(query)]
        scores = {}
        for cid, (tf, length) in self._tf.items():
            s = 0.0
            for t in q:
                f = tf.get(t, 0)
                if f:
                    s += self._idf.get(t, 0) * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * length / self._avgdl))
            if s:
                scores[cid] = s
        return scores

    # --- tools' backends -------------------------------------------------------------------------------
    def search(self, query: str, k: int = 5, regulator: str | None = None) -> list[dict]:
        dense = self.store.similarity_search_with_score(query, k=min(len(self.chunks), 25))
        dense_scores = {d.metadata["chunk_id"]: float(s) for d, s in dense}
        lexical = self._bm25(query)
        top_lex = max(lexical.values(), default=1.0) or 1.0
        candidates = set(dense_scores) | set(sorted(lexical, key=lexical.get, reverse=True)[:25])
        results = []
        for cid in candidates:
            chunk = self.chunks[cid]
            if regulator and chunk["metadata"].get("regulator") != regulator:
                continue
            score = 0.55 * max(dense_scores.get(cid, 0.0), 0.0) + 0.45 * lexical.get(cid, 0.0) / top_lex
            results.append(self._view(cid, score))
        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:k]

    def clause(self, clause_id: str) -> dict | None:
        parts = [(c["metadata"]["chunk_no"], cid) for cid, c in self.chunks.items()
                 if c["metadata"]["clause_id"] == clause_id]
        if not parts:
            return None
        parts.sort()
        first = self._view(parts[0][1], 1.0)
        first["text"] = " ".join(self.chunks[cid]["metadata"]["passage"] for _, cid in parts)
        return first

    def modifiers(self, clause_id: str) -> list[dict]:
        """Provisions that declare they modify `clause_id`, plus exclusion clauses of the same regulator."""
        target = next((c for c in self.chunks.values() if c["metadata"]["clause_id"] == clause_id), None)
        if target is None:
            return []
        regulator = target["metadata"]["regulator"]
        seen, out = set(), []
        for cid, chunk in self.chunks.items():
            meta = chunk["metadata"]
            if meta["clause_id"] == clause_id or meta["clause_id"] in seen:
                continue
            if clause_id in meta.get("modifies", []) or (meta.get("kind") == "exclusion" and meta["regulator"] == regulator):
                seen.add(meta["clause_id"])
                out.append(self.clause(meta["clause_id"]))
        return out

    def _view(self, cid: str, score: float) -> dict:
        meta = self.chunks[cid]["metadata"]
        return {"chunk_id": cid, "clause_id": meta["clause_id"], "title": meta["title"], "regulator": meta["regulator"],
                "document": meta["document"], "reference": meta["reference"], "kind": meta.get("kind"),
                "covers": meta.get("covers", []), "excludes": meta.get("excludes", []),
                "modifies": meta.get("modifies", []), "text": meta["passage"], "score": round(score, 4)}


_lock = threading.Lock()


@lru_cache(maxsize=4)
def _load(index_dir: str, built_at: float) -> CorpusIndex:
    return CorpusIndex(index_dir)


def get_index(index_dir: str | None = None) -> CorpusIndex:
    """Load the index; reloads automatically when the indexer publishes a new manifest."""
    index_dir = index_dir or get_settings().index_dir
    with _lock:
        built_at = json.loads((Path(index_dir) / "manifest.json").read_text())["built_at"]
        return _load(index_dir, built_at)
