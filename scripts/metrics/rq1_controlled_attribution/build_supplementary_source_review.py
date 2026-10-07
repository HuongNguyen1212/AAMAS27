#!/usr/bin/env python3
"""Build the blinded supplementary source-support review packet."""

from __future__ import annotations

import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CANDIDATES_PATH = ROOT / "archive/rq1/legacy_benchmarks/forward_baseline_v1/baseline_candidates.json"
ROUTE_PACKET_PATH = ROOT / "archive/rq1/route_authoring_history/route_authoring_packet.json"
CV_SCHEMA_PATH = ROOT / "inputs/bootstrap_schema_cv.json"
OUTPUT_PATH = ROOT / "docs/supplementary-source-review/review_cases.json"

# Fixed opaque ordering. Original query IDs are not written to the public packet.
TARGET_ORDER = ["Q031", "Q014", "Q022", "Q040", "Q016", "Q035", "Q015", "Q028"]


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def schema_fields_from_mapping(fields: dict) -> list[dict]:
    return [{"name": name, **copy.deepcopy(spec)} for name, spec in fields.items()]


def source_evidence_from_inventory(item: dict) -> dict:
    records = []
    for index, source in enumerate(item.get("source_inventory", []), start=1):
        metadata = {"source_file": source.get("file_name", "")}
        for key, value in (source.get("header_metadata") or {}).items():
            metadata[key.lower()] = value
        records.append(
            {
                "record_id": f"source-{index}",
                "source_index": index,
                "domain": item.get("domain", ""),
                "record_metadata": metadata,
                "row_count": source.get("row_count", 0),
                "table_columns": source.get("table_columns", []),
                "table_rows_available": True,
                "context_fields": [],
            }
        )
    return {
        "domain": item.get("domain", ""),
        "permitted_context_evidence": "",
        "record_count": len(records),
        "records": records,
    }


def q014_case(route_item: dict, cv_schema: dict) -> dict:
    fields = schema_fields_from_mapping(cv_schema["fields"])
    fields.extend(
        [
            {
                "name": "waxs_phase_data",
                "type": "object",
                "description": "WAXS phase information linked to the measured sample.",
                "comment": "Populate only from an explicitly available WAXS record for the same sample.",
            },
            {
                "name": "saxs_phase_data",
                "type": "object",
                "description": "SAXS phase information linked to the measured sample.",
                "comment": "Populate only from an explicitly available SAXS record for the same sample.",
            },
        ]
    )
    return {
        "domain": route_item["domain"],
        "question": route_item["question"],
        "schema_fields": fields,
        "metadata": {},
        "metadata_records": [],
        "system_answer": "No answer.",
        "rejection_reason": "The proxy evaluator rejected this response.",
        "source_files": [source["source_file"] for source in route_item.get("source_inventory", [])],
        "source_evidence": source_evidence_from_inventory(route_item),
    }


def candidate_case(candidate: dict, route_item: dict) -> dict:
    metadata = copy.deepcopy(candidate.get("proposed_metadata") or {})
    required_names = {
        field["name"] for field in candidate.get("required_route_fields", []) if field.get("name")
    }
    for name in required_names:
        metadata.pop(name, None)

    # These two values came from narrative dataset context, not from the raw DIL files
    # that define the source boundary for this supplementary review.
    if candidate["query_id"] == "Q015":
        metadata.pop("sample_material", None)
    if candidate["query_id"] == "Q022":
        metadata.pop("hydrogen_charging_method", None)

    route_bindings = copy.deepcopy(candidate.get("metadata_route_bindings") or {})
    metadata.update(route_bindings)
    return {
        "domain": candidate["domain"],
        "question": candidate["question"],
        "schema_fields": candidate.get("proposed_baseline_schema_fields", []),
        "metadata": metadata,
        "metadata_records": [],
        "system_answer": "No answer.",
        "rejection_reason": "The proxy evaluator rejected this response.",
        "source_files": [source["source_file"] for source in route_item.get("source_inventory", [])],
        "source_evidence": source_evidence_from_inventory(route_item),
    }


def main() -> None:
    candidates = {item["query_id"]: item for item in load_json(CANDIDATES_PATH)["candidates"]}
    route_items = {item["query_id"]: item for item in load_json(ROUTE_PACKET_PATH)["items"]}
    cv_schema = load_json(CV_SCHEMA_PATH)

    cases = []
    for index, query_id in enumerate(TARGET_ORDER, start=1):
        route_item = route_items[query_id]
        case = q014_case(route_item, cv_schema) if query_id == "Q014" else candidate_case(candidates[query_id], route_item)
        case["case_id"] = f"S-{index:04d}"
        cases.append(case)

    payload = {
        "protocol": "rq1-supplementary-source-support-blind-audit-v1",
        "case_count": len(cases),
        "cases": cases,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(cases)} blinded cases to {OUTPUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
