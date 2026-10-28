import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="session", autouse=True)
def environment(tmp_path_factory):
    index_dir = tmp_path_factory.mktemp("index")
    os.environ.update({"LLM_MODE": "inprocess", "INDEX_DIR": str(index_dir), "CORPUS_DIR": str(ROOT / "corpus"),
                       "EMBEDDING_BACKEND": "hash", "LLM_BACKOFF_BASE_S": "0.01", "DEMO_FAULTS_ENABLED": "true",
                       "RATE_LIMIT_PER_MIN": "1000"})
    os.environ.pop("REDIS_URL", None)
    os.environ.pop("VERIFIER_URL", None)
    from app.retrieval.ingest import build_index

    build_index(str(ROOT / "corpus"), str(index_dir), "clause", "hash", None)
    yield


def complaint(text, **kw):
    body = {"complaint_text": text, "complainant": {"name": "Test Investor", "state": "Karnataka"},
            "incident_date": "2026-08-01", "first_approached_entity": False}
    body.update(kw)
    return body


DIFFICULT = ("I invested in a fixed deposit through my bank's app. The interest credited is lower than what I was "
             "promised. I want to complain to SEBI.")
