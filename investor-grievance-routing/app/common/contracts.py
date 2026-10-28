"""Data contracts for every external interface (D1, F1).

The JSON Schemas in /contracts are generated from these models (`python -m app.common.contracts`), so
the published contract and the enforced contract cannot drift apart.
"""
from __future__ import annotations

import datetime as dt
import re
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

CONTRACT_VERSION = "1.0.0"
EARLIEST_INCIDENT = dt.date(1995, 1, 1)


class EntityType(str, Enum):
    broker = "broker"
    mutual_fund = "mutual_fund"
    registrar = "registrar"
    listed_company = "listed_company"
    depository_participant = "depository_participant"
    depository = "depository"
    bank = "bank"
    nbfc = "nbfc"
    insurer = "insurer"
    other = "other"
    unknown = "unknown"


class Product(str, Enum):
    equity_shares = "equity_shares"
    mutual_fund_units = "mutual_fund_units"
    bonds_debentures = "bonds_debentures"
    derivatives = "derivatives"
    fixed_deposit = "fixed_deposit"
    savings_account = "savings_account"
    loan = "loan"
    insurance_policy = "insurance_policy"
    pension = "pension"
    other = "other"
    unknown = "unknown"


class InvestorType(str, Enum):
    individual = "individual"
    huf = "huf"
    nri = "nri"
    corporate = "corporate"


class Complainant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=100)
    email: str | None = Field(default=None, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
    state: str = Field(min_length=2, max_length=40, description="Indian state or union territory of residence")
    investor_type: InvestorType = InvestorType.individual


class RunOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt_variant: Literal["v1", "v2"] | None = None
    demo_fault: Literal["unsupported_draft"] | None = Field(
        default=None, description="Accepted only when DEMO_FAULTS_ENABLED=true; forces a bad first draft")


class ComplaintRequest(BaseModel):
    """POST /v1/complaints request body."""
    model_config = ConfigDict(extra="forbid")

    complaint_text: str = Field(min_length=30, max_length=4000)
    complainant: Complainant
    entity_name: str | None = Field(default=None, min_length=2, max_length=200)
    entity_type_claimed: EntityType = EntityType.unknown
    product: Product = Product.unknown
    amount_involved_inr: float | None = Field(default=None, ge=0, le=1e10)
    incident_date: dt.date
    first_approached_entity: bool
    entity_response_date: dt.date | None = None
    callback_url: HttpUrl | None = None
    client_reference: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    options: RunOptions = RunOptions()

    @field_validator("complaint_text")
    @classmethod
    def _meaningful_text(cls, value: str) -> str:
        words = re.findall(r"[A-Za-z]{2,}", value)
        if len(words) < 6:
            raise ValueError("complaint_text must describe the grievance in at least six words")
        if len(set(w.lower() for w in words)) < 4:
            raise ValueError("complaint_text looks like repeated filler")
        return value.strip()

    @field_validator("incident_date")
    @classmethod
    def _incident_in_range(cls, value: dt.date) -> dt.date:
        if value < EARLIEST_INCIDENT:
            raise ValueError(f"incident_date must be on or after {EARLIEST_INCIDENT.isoformat()}")
        if value > dt.date.today():
            raise ValueError("incident_date cannot be in the future")
        return value

    @model_validator(mode="after")
    def _cross_field(self) -> "ComplaintRequest":
        if self.entity_response_date is not None:
            if not self.first_approached_entity:
                raise ValueError("entity_response_date given but first_approached_entity is false")
            if self.entity_response_date < self.incident_date:
                raise ValueError("entity_response_date is before incident_date")
            if self.entity_response_date > dt.date.today():
                raise ValueError("entity_response_date cannot be in the future")
        if self.product in (Product.fixed_deposit, Product.savings_account, Product.loan) and \
                self.entity_type_claimed in (EntityType.insurer,):
            raise ValueError("product is a banking product but entity_type_claimed is insurer")
        if self.amount_involved_inr is not None and self.amount_involved_inr > 0 and \
                self.product == Product.unknown and self.entity_type_claimed == EntityType.unknown:
            raise ValueError("a monetary claim needs at least one of product or entity_type_claimed")
        return self


class Citation(BaseModel):
    clause_id: str
    quote: str
    document: str | None = None
    reference: str | None = None


RouteType = Literal["assign_to_entity", "refer_to_other_regulator", "not_maintainable", "escalate_to_human"]


class Determination(BaseModel):
    route: RouteType
    regulator: str | None = None
    entity_type: str | None = None
    entity_name: str | None = None
    designated_body: str | None = None
    timeline: str | None = None
    basis: str
    reason: str | None = None
    citations: list[Citation] = []
    escalation_path: str | None = None


class SubmitResponse(BaseModel):
    run_id: str
    status: Literal["queued", "completed"]
    status_url: str
    cache_hit: bool = False
    contract_version: str = CONTRACT_VERSION


class RunStatus(BaseModel):
    run_id: str
    status: Literal["queued", "running", "completed", "escalated", "failed"]
    determination: Determination | None = None
    verified: bool | None = None
    degraded: bool | None = None
    prompt_versions: dict | None = None
    index_version: str | None = None
    cost_usd: float | None = None
    latency_s: float | None = None
    notice: str = "Advisory routing determination only. A grievance officer decides; the system never disposes of a complaint."


class Feedback(BaseModel):
    """POST /v1/runs/{run_id}/feedback request body."""
    model_config = ConfigDict(extra="forbid")
    satisfactory: bool
    reason: str = Field(default="", max_length=500)


def field_errors(exc) -> list[dict]:
    """Flatten pydantic errors into field-level quarantine records."""
    out = []
    for err in exc.errors():
        out.append({"field": ".".join(str(p) for p in err.get("loc", ())) or "<root>",
                    "type": err.get("type"), "message": err.get("msg")})
    return out


if __name__ == "__main__":  # regenerate the published JSON Schemas
    import json
    import pathlib

    out = pathlib.Path(__file__).resolve().parents[2] / "contracts"
    out.mkdir(exist_ok=True)
    for name, model in {"complaint_request": ComplaintRequest, "submit_response": SubmitResponse,
                        "run_status": RunStatus, "feedback": Feedback, "determination": Determination}.items():
        schema = model.model_json_schema()
        schema["$id"] = f"https://igr.local/contracts/{name}.schema.json"
        schema["x-contract-version"] = CONTRACT_VERSION
        (out / f"{name}.schema.json").write_text(json.dumps(schema, indent=2) + "\n")
        print("wrote", name)
