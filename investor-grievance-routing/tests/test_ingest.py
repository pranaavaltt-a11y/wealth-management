import json
from pathlib import Path

from app.retrieval.ingest import build_index

ROOT = Path(__file__).resolve().parents[1]


def test_ingest_is_idempotent_and_reembeds_one_document(tmp_path):
    first = build_index(str(ROOT / "corpus"), str(tmp_path), "clause", "hash", None)
    assert first["mode"] == "full" and first["chunks_embedded_this_run"] == first["chunks_total"]
    second = build_index(str(ROOT / "corpus"), str(tmp_path), "clause", "hash", None)
    assert second["mode"] == "incremental" and second["chunks_embedded_this_run"] == 0
    assert second["index_version"] == first["index_version"]
    third = build_index(str(ROOT / "corpus"), str(tmp_path), "clause", "hash", None, reembed=["RBI-IOS"])
    rbi_chunks = first["documents"]["RBI-IOS"]["chunks"]
    assert third["chunks_embedded_this_run"] == rbi_chunks == third["chunks_deleted_this_run"]
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["chunks_total"] == first["chunks_total"]
