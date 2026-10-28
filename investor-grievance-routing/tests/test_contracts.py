import datetime as dt

import pytest
from pydantic import ValidationError

from app.common.contracts import ComplaintRequest
from tests.conftest import DIFFICULT, complaint


def test_valid_request():
    req = ComplaintRequest.model_validate(complaint(DIFFICULT))
    assert req.entity_type_claimed.value == "unknown"


@pytest.mark.parametrize("patch, field", [
    ({"complaint_text": "too short"}, "complaint_text"),
    ({"incident_date": (dt.date.today() + dt.timedelta(days=3)).isoformat()}, "incident_date"),
    ({"incident_date": "1980-01-01"}, "incident_date"),
    ({"amount_involved_inr": -5}, "amount_involved_inr"),
    ({"entity_type_claimed": "astrologer"}, "entity_type_claimed"),
    ({"unexpected": 1}, "unexpected"),
    ({"complainant": {"name": "A", "state": "KA"}}, "complainant.name"),
])
def test_field_level_rejections(patch, field):
    with pytest.raises(ValidationError) as exc:
        ComplaintRequest.model_validate(complaint(DIFFICULT, **patch))
    assert any(field in ".".join(map(str, e["loc"])) for e in exc.value.errors())


def test_cross_field_response_without_approach():
    with pytest.raises(ValidationError, match="first_approached_entity is false"):
        ComplaintRequest.model_validate(complaint(DIFFICULT, entity_response_date="2026-08-05"))


def test_cross_field_response_before_incident():
    with pytest.raises(ValidationError, match="before incident_date"):
        ComplaintRequest.model_validate(complaint(DIFFICULT, first_approached_entity=True,
                                                  entity_response_date="2026-07-01"))
