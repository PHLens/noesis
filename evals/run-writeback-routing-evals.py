#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


SCHEMA_VERSION = "0.1"
ALLOWED_CATEGORIES = {"meta", "domain", "mixed", "transient"}
ALLOWED_DESTINATIONS = {"pamem-experience", "wiki-stage", "split", "none"}
ALLOWED_CONFIDENCE = {"high", "medium", "low"}
ALLOWED_ACTIONS = {"append-experience", "stage-wiki-note", "split-item", "discard", "request-review"}
ALLOWED_SOURCE_REF_TYPES = {"conversation", "file", "url", "note"}
COMPARABLE_FIELDS = {"category", "destination", "confidence", "review_required", "suggested_action"}


class RoutingEvalError(Exception):
    pass


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    return 2


def read_jsonl(path):
    rows = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise RoutingEvalError(f"failed to read {path}: {exc.strerror}") from exc
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RoutingEvalError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise RoutingEvalError(f"{path}:{line_number}: JSONL row must be an object")
        rows.append((line_number, data))
    return rows


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise RoutingEvalError(f"failed to read {path}: {exc.strerror}") from exc
    except json.JSONDecodeError as exc:
        raise RoutingEvalError(f"{path}: malformed intent artifact JSON: {exc}") from exc


def require_string(data, field_name, context):
    value = data.get(field_name)
    if not isinstance(value, str) or not value.strip():
        raise RoutingEvalError(f"{context}: {field_name} must be a non-empty string")
    return value


def require_object(data, field_name, context):
    value = data.get(field_name)
    if not isinstance(value, dict):
        raise RoutingEvalError(f"{context}: {field_name} must be an object")
    return value


def require_list(data, field_name, context):
    value = data.get(field_name)
    if not isinstance(value, list):
        raise RoutingEvalError(f"{context}: {field_name} must be a list")
    return value


def validate_enum_field(value, field_name, allowed_values, context):
    if not isinstance(value, str) or value not in allowed_values:
        raise RoutingEvalError(f"{context}: invalid {field_name}: {value}")


def validate_source_refs(source_refs, context):
    if not isinstance(source_refs, list):
        raise RoutingEvalError(f"{context}: source_refs must be a list")
    for index, source_ref in enumerate(source_refs):
        ref_context = f"{context}:source_refs[{index}]"
        if not isinstance(source_ref, dict):
            raise RoutingEvalError(f"{ref_context}: source_refs entry must be an object")
        for field_name in ("type", "ref", "summary"):
            require_string(source_ref, field_name, ref_context)
        validate_enum_field(source_ref["type"], "type", ALLOWED_SOURCE_REF_TYPES, ref_context)


def validate_item_fields(item, context):
    if not isinstance(item, dict):
        raise RoutingEvalError(f"{context}: item must be an object")
    for field_name, value in item.items():
        if field_name == "category":
            validate_enum_field(value, "category", ALLOWED_CATEGORIES, context)
        elif field_name == "destination":
            validate_enum_field(value, "destination", ALLOWED_DESTINATIONS, context)
        elif field_name == "confidence":
            validate_enum_field(value, "confidence", ALLOWED_CONFIDENCE, context)
        elif field_name == "review_required" and not isinstance(value, bool):
            raise RoutingEvalError(f"{context}: review_required must be a bool")
        elif field_name == "suggested_action":
            validate_enum_field(value, "suggested_action", ALLOWED_ACTIONS, context)


def load_golden(path):
    cases = {}
    for line_number, data in read_jsonl(path):
        context = f"{path}:{line_number}"
        case_id = require_string(data, "id", context)
        if case_id in cases:
            raise RoutingEvalError(f"{context}: duplicate case id: {case_id}")
        require_object(data, "input", context)
        require_string(data, "reason", context)
        expected_items = require_list(data, "expected_items", context)
        if not expected_items:
            raise RoutingEvalError(f"{context}: expected_items must not be empty")
        for index, item in enumerate(expected_items):
            item_context = f"{context}:expected_items[{index}]"
            validate_item_fields(item, item_context)
            if not (set(item) & COMPARABLE_FIELDS):
                raise RoutingEvalError(f"{item_context}: must include at least one comparable field")
        cases[case_id] = data
    if not cases:
        raise RoutingEvalError(f"{path}: no eval cases found")
    return cases


def get_prediction_items(data, context):
    for field_name in ("items", "predicted_items", "actual_items"):
        if field_name in data:
            items = data[field_name]
            if not isinstance(items, list):
                raise RoutingEvalError(f"{context}: {field_name} must be a list")
            return items
    raise RoutingEvalError(f"{context}: prediction row must include items, predicted_items, or actual_items")


def load_predictions_jsonl(path):
    predictions = {}
    for line_number, data in read_jsonl(path):
        context = f"{path}:{line_number}"
        case_id = data.get("id")
        if not isinstance(case_id, str) or not case_id.strip():
            case_id = data.get("case_id")
        if not isinstance(case_id, str) or not case_id.strip():
            raise RoutingEvalError(f"{context}: prediction row must include id or case_id")
        if case_id in predictions:
            raise RoutingEvalError(f"{context}: duplicate prediction id: {case_id}")
        items = get_prediction_items(data, context)
        for index, item in enumerate(items):
            validate_item_fields(item, f"{context}:items[{index}]")
        predictions[case_id] = {"source": str(path), "line": line_number, "items": items}
    return predictions


def validate_intent_item(item, context):
    required = [
        "id",
        "title",
        "summary",
        "category",
        "destination",
        "confidence",
        "review_required",
        "suggested_action",
        "reason",
    ]
    if not isinstance(item, dict):
        raise RoutingEvalError(f"{context}: item must be an object")
    missing = [field for field in required if field not in item]
    if missing:
        raise RoutingEvalError(f"{context}: missing item fields: {', '.join(missing)}")
    for field_name in ("id", "title", "summary", "reason"):
        require_string(item, field_name, context)
    if "eval_case_id" in item:
        require_string(item, "eval_case_id", context)
    if "source_refs" in item:
        validate_source_refs(item["source_refs"], context)
    validate_item_fields(item, context)


def validate_intent_artifact(data, path):
    if not isinstance(data, dict):
        raise RoutingEvalError(f"{path}: intent artifact must be an object")
    required = ["schema_version", "intent_id", "created_at", "workspace", "task_summary", "source_refs", "items"]
    missing = [field for field in required if field not in data]
    if missing:
        raise RoutingEvalError(f"{path}: missing intent fields: {', '.join(missing)}")
    schema_version = require_string(data, "schema_version", path)
    for field_name in ("intent_id", "created_at", "workspace", "task_summary"):
        require_string(data, field_name, path)
    if schema_version != SCHEMA_VERSION:
        raise RoutingEvalError(f"{path}: unsupported schema_version: {schema_version}")
    validate_source_refs(data["source_refs"], path)
    items = require_list(data, "items", path)
    if not items:
        raise RoutingEvalError(f"{path}: items must not be empty")
    for index, item in enumerate(items):
        validate_intent_item(item, f"{path}:items[{index}]")


def load_intent_predictions(path):
    data = read_json(path)
    validate_intent_artifact(data, path)
    grouped = {}
    batch_case_id = None
    if "eval_case_id" in data:
        batch_case_id = require_string(data, "eval_case_id", path)
    for index, item in enumerate(data["items"]):
        if "eval_case_id" in item:
            case_id = item["eval_case_id"]
        elif batch_case_id:
            case_id = batch_case_id
        else:
            raise RoutingEvalError(
                f"{path}:items[{index}]: eval_case_id is required when batch eval_case_id is absent"
            )
        grouped.setdefault(case_id, {"source": str(path), "items": []})["items"].append(item)
    if not grouped:
        raise RoutingEvalError(f"{path}: intent prediction source requires batch or item eval_case_id")
    return grouped


def item_matches(expected, actual):
    for field_name, expected_value in expected.items():
        if field_name not in COMPARABLE_FIELDS:
            continue
        if actual.get(field_name) != expected_value:
            return False
    return True


def match_expected_items(expected_items, predicted_items):
    candidate_predictions = [
        [
            predicted_index
            for predicted_index, predicted in enumerate(predicted_items)
            if item_matches(expected, predicted)
        ]
        for expected in expected_items
    ]
    prediction_to_expected = {}

    def assign(expected_index, seen_predictions):
        for predicted_index in candidate_predictions[expected_index]:
            if predicted_index in seen_predictions:
                continue
            seen_predictions.add(predicted_index)
            previous_expected = prediction_to_expected.get(predicted_index)
            if previous_expected is None or assign(previous_expected, seen_predictions):
                prediction_to_expected[predicted_index] = expected_index
                return True
        return False

    for expected_index in range(len(expected_items)):
        assign(expected_index, set())

    expected_to_prediction = {
        expected_index: predicted_index
        for predicted_index, expected_index in prediction_to_expected.items()
    }
    matched = [
        {"expected_index": expected_index, "predicted_index": expected_to_prediction[expected_index]}
        for expected_index in range(len(expected_items))
        if expected_index in expected_to_prediction
    ]
    missing = [
        {"expected_index": expected_index, "expected": expected}
        for expected_index, expected in enumerate(expected_items)
        if expected_index not in expected_to_prediction
    ]
    used = set(expected_to_prediction.values())
    extras = [
        {"predicted_index": index, "predicted": item}
        for index, item in enumerate(predicted_items)
        if index not in used
    ]
    return matched, missing, extras


def evaluate(golden_cases, predictions, strict_extra=False):
    results = []
    passed = 0
    failed = 0
    for case_id, case in golden_cases.items():
        prediction = predictions.get(case_id)
        expected_items = case["expected_items"]
        if prediction is None:
            failed += 1
            results.append(
                {
                    "id": case_id,
                    "status": "fail",
                    "reason": "missing prediction",
                    "expected_items": expected_items,
                    "predicted_items": [],
                    "matched_items": [],
                    "missing_expected_items": [
                        {"expected_index": index, "expected": item}
                        for index, item in enumerate(expected_items)
                    ],
                    "extra_predicted_items": [],
                }
            )
            continue
        predicted_items = prediction["items"]
        matched, missing, extras = match_expected_items(expected_items, predicted_items)
        is_failure = bool(missing) or (strict_extra and bool(extras))
        if is_failure:
            failed += 1
            status = "fail"
        else:
            passed += 1
            status = "pass"
        results.append(
            {
                "id": case_id,
                "status": status,
                "expected_items": expected_items,
                "predicted_items": predicted_items,
                "matched_items": matched,
                "missing_expected_items": missing,
                "extra_predicted_items": extras,
            }
        )

    unknown_predictions = sorted(set(predictions) - set(golden_cases))
    if strict_extra:
        for case_id in unknown_predictions:
            failed += 1
            results.append(
                {
                    "id": case_id,
                    "status": "fail",
                    "reason": "prediction has no golden case",
                    "expected_items": [],
                    "predicted_items": predictions[case_id]["items"],
                    "matched_items": [],
                    "missing_expected_items": [],
                    "extra_predicted_items": [
                        {"predicted_index": index, "predicted": item}
                        for index, item in enumerate(predictions[case_id]["items"])
                    ],
                }
            )
    return results, passed, failed, unknown_predictions


def build_report(golden_path, prediction_sources, golden_cases, predictions, strict_extra=False):
    results, passed, failed, unknown_predictions = evaluate(golden_cases, predictions, strict_extra)
    return {
        "schema_version": SCHEMA_VERSION,
        "golden_path": str(golden_path),
        "prediction_sources": [str(path) for path in prediction_sources],
        "strict_extra": strict_extra,
        "summary": {
            "case_count": len(golden_cases),
            "prediction_count": len(predictions),
            "passed_count": passed,
            "failed_count": failed,
            "missing_prediction_count": sum(1 for result in results if result.get("reason") == "missing prediction"),
            "unknown_prediction_count": len(unknown_predictions),
        },
        "unknown_predictions": unknown_predictions,
        "results": results,
    }


def print_human(report):
    summary = report["summary"]
    print(
        "Writeback routing evals: "
        f"{summary['passed_count']} passed, "
        f"{summary['failed_count']} failed, "
        f"{summary['case_count']} golden case(s), "
        f"{summary['prediction_count']} prediction(s)."
    )
    if report["unknown_predictions"]:
        print("Unknown prediction ids:")
        for case_id in report["unknown_predictions"]:
            print(f"  {case_id}")
    for result in report["results"]:
        has_extra_predictions = bool(result.get("extra_predicted_items"))
        if result["status"] == "pass" and not has_extra_predictions:
            continue
        print(f"{result['id']}: {result['status']}")
        if result.get("reason"):
            print(f"  reason: {result['reason']}")
        for item in result.get("missing_expected_items", []):
            print(f"  missing expected[{item['expected_index']}]: {json.dumps(item['expected'], ensure_ascii=False)}")
        for item in result.get("extra_predicted_items", []):
            print(f"  extra predicted[{item['predicted_index']}]: {json.dumps(item['predicted'], ensure_ascii=False)}")


def build_parser():
    parser = argparse.ArgumentParser(
        prog="run-writeback-routing-evals",
        description="Compare writeback-router predictions against golden routing JSONL cases.",
    )
    parser.add_argument("--golden", default="evals/writeback-routing.jsonl", help="Golden routing eval JSONL")
    parser.add_argument("--predictions", action="append", default=[], help="Prediction JSONL source")
    parser.add_argument("--intent", action="append", default=[], help="Writeback intent artifact JSON source")
    parser.add_argument("--json", action="store_true", help="Emit structured JSON report")
    parser.add_argument("--strict-extra", action="store_true", help="Fail on extra predicted items or unknown ids")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        golden_path = Path(args.golden).expanduser()
        prediction_paths = [Path(path).expanduser() for path in args.predictions]
        intent_paths = [Path(path).expanduser() for path in args.intent]
        prediction_sources = [*prediction_paths, *intent_paths]
        if not prediction_sources:
            raise RoutingEvalError("at least one --predictions or --intent source is required")

        golden_cases = load_golden(golden_path)
        predictions = {}
        for path in prediction_paths:
            for case_id, prediction in load_predictions_jsonl(path).items():
                if case_id in predictions:
                    raise RoutingEvalError(f"duplicate prediction id across sources: {case_id}")
                predictions[case_id] = prediction
        for path in intent_paths:
            for case_id, prediction in load_intent_predictions(path).items():
                if case_id in predictions:
                    raise RoutingEvalError(f"duplicate prediction id across sources: {case_id}")
                predictions[case_id] = prediction
        report = build_report(golden_path, prediction_sources, golden_cases, predictions, args.strict_extra)
    except RoutingEvalError as exc:
        return fail(str(exc))

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_human(report)
    return 1 if report["summary"]["failed_count"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
