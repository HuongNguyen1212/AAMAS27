#!/usr/bin/env python3
"""Build a blinded review packet for source-data-dependent cases."""

from __future__ import annotations

import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CONTROLLED_PACKET_PATH = ROOT / "docs/controlled-rereview/review_cases.json"
OUTPUT_PATH = ROOT / "docs/supplementary-source-review/review_cases.json"

# These verified routes require calculations or comparisons over source-file
# columns. The selected controlled cases preserve the schema while withholding
# source evidence needed for the answer.
TARGET_CASE_IDS = [
    "C-0069",  # Q002: compare two potential columns
    "C-0034",  # Q003: assess sampling intervals
    "C-0001",  # Q006: derive start, end, and range
    "C-0061",  # Q007: detect current spikes
    "C-0043",  # Q021: assess time spacing
    "C-0083",  # Q023: compare derivative with numerical differentiation
    "C-0073",  # Q025: derive temperature range
    "C-0091",  # Q038: correlate three dilatation measurements
]


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    source_packet = load_json(CONTROLLED_PACKET_PATH)
    source_cases = {case["case_id"]: case for case in source_packet["cases"]}

    cases = []
    for index, controlled_case_id in enumerate(TARGET_CASE_IDS, start=1):
        case = copy.deepcopy(source_cases[controlled_case_id])
        case["case_id"] = f"S-{index:04d}"
        case.pop("review_status", None)
        cases.append(case)

    payload = {
        "protocol": "rq1-supplementary-source-data-blind-audit-v3",
        "case_count": len(cases),
        "cases": cases,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(cases)} blinded cases to {OUTPUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
