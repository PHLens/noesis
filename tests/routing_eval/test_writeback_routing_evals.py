import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER = REPO_ROOT / "evals" / "run-writeback-routing-evals.py"
GOLDEN = REPO_ROOT / "evals" / "writeback-routing.jsonl"


class WritebackRoutingEvalRunnerTest(unittest.TestCase):
    def write_jsonl(self, path, rows):
        path.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
            encoding="utf-8",
        )

    def write_intent(self, path, data):
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def run_eval(self, predictions, *args, golden=GOLDEN, check=True):
        with tempfile.TemporaryDirectory() as tmp:
            prediction_path = Path(tmp) / "predictions.jsonl"
            self.write_jsonl(prediction_path, predictions)
            command = [
                sys.executable,
                str(RUNNER),
                "--golden",
                str(golden),
                "--predictions",
                str(prediction_path),
                "--json",
                *args,
            ]
            result = subprocess.run(
                command,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            if check and result.returncode != 0:
                self.fail(
                    f"routing eval failed with {result.returncode}\n"
                    f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
                )
            return result

    def run_human_eval(self, predictions, *args, golden=GOLDEN, check=True):
        with tempfile.TemporaryDirectory() as tmp:
            prediction_path = Path(tmp) / "predictions.jsonl"
            self.write_jsonl(prediction_path, predictions)
            command = [
                sys.executable,
                str(RUNNER),
                "--golden",
                str(golden),
                "--predictions",
                str(prediction_path),
                *args,
            ]
            result = subprocess.run(
                command,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            if check and result.returncode != 0:
                self.fail(
                    f"human routing eval failed with {result.returncode}\n"
                    f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
                )
            return result

    def run_intent_eval(self, intent_data, *args, check=True):
        with tempfile.TemporaryDirectory() as tmp:
            intent_path = Path(tmp) / "intent.json"
            self.write_intent(intent_path, intent_data)
            command = [
                sys.executable,
                str(RUNNER),
                "--golden",
                str(GOLDEN),
                "--intent",
                str(intent_path),
                "--json",
                *args,
            ]
            result = subprocess.run(
                command,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            if check and result.returncode != 0:
                self.fail(
                    f"intent routing eval failed with {result.returncode}\n"
                    f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
                )
            return result

    def full_predictions(self):
        return [
            {
                "id": "user-preference-language",
                "items": [
                    {
                        "category": "meta",
                        "destination": "pamem-experience",
                        "review_required": True,
                        "suggested_action": "request-review",
                    }
                ],
            },
            {
                "id": "tool-behavior-plugin-scope",
                "items": [
                    {
                        "category": "meta",
                        "destination": "pamem-experience",
                        "review_required": False,
                        "suggested_action": "append-experience",
                    }
                ],
            },
            {
                "id": "domain-concept-dtensor",
                "items": [
                    {
                        "category": "domain",
                        "destination": "wiki-stage",
                        "review_required": True,
                        "suggested_action": "stage-wiki-note",
                    }
                ],
            },
            {
                "id": "mixed-router-boundary",
                "items": [
                    {"category": "meta", "destination": "pamem-experience"},
                    {"category": "domain", "destination": "wiki-stage"},
                ],
            },
            {
                "id": "transient-git-status",
                "items": [
                    {
                        "category": "transient",
                        "destination": "none",
                        "review_required": False,
                        "suggested_action": "discard",
                    }
                ],
            },
            {
                "id": "low-confidence-source",
                "items": [
                    {
                        "confidence": "low",
                        "review_required": True,
                        "suggested_action": "request-review",
                    }
                ],
            },
        ]

    def base_intent(self, **overrides):
        data = {
            "schema_version": "0.1",
            "intent_id": "test-intent",
            "created_at": "2026-04-27T15:30:00Z",
            "workspace": str(REPO_ROOT),
            "task_summary": "Test routing eval intent source.",
            "source_refs": [],
            "items": [],
        }
        data.update(overrides)
        return data

    def valid_intent_item(self, **overrides):
        item = {
            "id": "item-1",
            "title": "DTensor",
            "summary": "Domain concept.",
            "category": "domain",
            "destination": "wiki-stage",
            "confidence": "medium",
            "review_required": True,
            "suggested_action": "stage-wiki-note",
            "reason": "Domain concept belongs in wiki.",
        }
        item.update(overrides)
        return item

    def test_help(self):
        result = subprocess.run(
            [sys.executable, str(RUNNER), "--help"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage:", result.stdout.lower())

    def test_malformed_prediction_jsonl_is_invalid_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            prediction_path = Path(tmp) / "predictions.jsonl"
            prediction_path.write_text("{not-json}\n", encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(RUNNER),
                    "--golden",
                    str(GOLDEN),
                    "--predictions",
                    str(prediction_path),
                    "--json",
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("invalid JSON", result.stderr)

    def test_duplicate_golden_id_is_invalid_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            golden_path = Path(tmp) / "golden.jsonl"
            prediction_path = Path(tmp) / "predictions.jsonl"
            self.write_jsonl(
                golden_path,
                [
                    {"id": "case-1", "input": {}, "expected_items": [{"category": "meta"}], "reason": "one"},
                    {"id": "case-1", "input": {}, "expected_items": [{"category": "domain"}], "reason": "two"},
                ],
            )
            self.write_jsonl(prediction_path, [])
            result = subprocess.run(
                [
                    sys.executable,
                    str(RUNNER),
                    "--golden",
                    str(golden_path),
                    "--predictions",
                    str(prediction_path),
                    "--json",
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("duplicate case id", result.stderr)

    def test_all_predictions_pass(self):
        result = self.run_eval(self.full_predictions())
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["summary"]["case_count"], 6)
        self.assertEqual(report["summary"]["passed_count"], 6)
        self.assertEqual(report["summary"]["failed_count"], 0)

    def test_expected_items_are_subset_matches(self):
        predictions = self.full_predictions()
        predictions[0]["items"][0]["title"] = "User language preference"
        predictions[0]["items"][0]["reason"] = "This affects future behavior."
        result = self.run_eval(predictions)
        report = json.loads(result.stdout)
        self.assertEqual(report["summary"]["failed_count"], 0)

    def test_overlapping_expected_items_use_valid_assignment(self):
        with tempfile.TemporaryDirectory() as tmp:
            golden_path = Path(tmp) / "golden.jsonl"
            self.write_jsonl(
                golden_path,
                [
                    {
                        "id": "overlap",
                        "input": {},
                        "expected_items": [
                            {"category": "meta"},
                            {"category": "meta", "destination": "pamem-experience"},
                        ],
                        "reason": "Broad expected items must not consume specific-only matches.",
                    }
                ],
            )
            predictions = [
                {
                    "id": "overlap",
                    "items": [
                        {"category": "meta", "destination": "pamem-experience"},
                        {"category": "meta", "destination": "wiki-stage"},
                    ],
                }
            ]
            result = self.run_eval(predictions, golden=golden_path)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["summary"]["failed_count"], 0)
        self.assertEqual(report["results"][0]["missing_expected_items"], [])
        self.assertEqual(report["results"][0]["extra_predicted_items"], [])
        self.assertIn(
            {"expected_index": 1, "predicted_index": 0},
            report["results"][0]["matched_items"],
        )

    def test_missing_expected_route_fails(self):
        predictions = self.full_predictions()
        predictions[2]["items"][0]["destination"] = "pamem-experience"
        result = self.run_eval(predictions, check=False)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 1)
        failed = [item for item in report["results"] if item["id"] == "domain-concept-dtensor"][0]
        self.assertEqual(failed["status"], "fail")
        self.assertEqual(failed["missing_expected_items"][0]["expected"]["destination"], "wiki-stage")

    def test_missing_prediction_fails(self):
        result = self.run_eval(self.full_predictions()[:-1], check=False)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["summary"]["missing_prediction_count"], 1)

    def test_extra_prediction_allowed_by_default(self):
        predictions = self.full_predictions()
        predictions[0]["items"].append({"category": "transient", "destination": "none"})
        result = self.run_eval(predictions)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 0)
        first = [item for item in report["results"] if item["id"] == "user-preference-language"][0]
        self.assertEqual(len(first["extra_predicted_items"]), 1)

    def test_human_report_includes_extra_prediction_allowed_by_default(self):
        predictions = self.full_predictions()
        predictions[0]["items"].append({"category": "transient", "destination": "none"})
        result = self.run_human_eval(predictions)
        self.assertEqual(result.returncode, 0)
        self.assertIn("user-preference-language: pass", result.stdout)
        self.assertIn("extra predicted[1]", result.stdout)

    def test_strict_extra_fails_on_extra_prediction(self):
        predictions = self.full_predictions()
        predictions[0]["items"].append({"category": "transient", "destination": "none"})
        result = self.run_eval(predictions, "--strict-extra", check=False)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 1)
        first = [item for item in report["results"] if item["id"] == "user-preference-language"][0]
        self.assertEqual(first["status"], "fail")

    def test_unknown_prediction_id_passes_by_default_but_is_reported(self):
        predictions = self.full_predictions()
        predictions.append({"id": "unknown-case", "items": [{"category": "meta"}]})
        result = self.run_eval(predictions)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["summary"]["unknown_prediction_count"], 1)
        self.assertEqual(report["unknown_predictions"], ["unknown-case"])

    def test_human_report_includes_unknown_prediction_id_allowed_by_default(self):
        predictions = self.full_predictions()
        predictions.append({"id": "unknown-case", "items": [{"category": "meta"}]})
        result = self.run_human_eval(predictions)
        self.assertEqual(result.returncode, 0)
        self.assertIn("Unknown prediction ids:", result.stdout)
        self.assertIn("unknown-case", result.stdout)

    def test_strict_extra_fails_unknown_prediction_id(self):
        predictions = self.full_predictions()
        predictions.append({"id": "unknown-case", "items": [{"category": "meta"}]})
        result = self.run_eval(predictions, "--strict-extra", check=False)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 1)
        failed = [item for item in report["results"] if item["id"] == "unknown-case"][0]
        self.assertEqual(failed["status"], "fail")
        self.assertEqual(failed["reason"], "prediction has no golden case")

    def test_predictions_jsonl_can_use_case_id_and_predicted_items(self):
        predictions = self.full_predictions()
        predictions[0]["case_id"] = predictions[0].pop("id")
        predictions[0]["predicted_items"] = predictions[0].pop("items")
        result = self.run_eval(predictions)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["summary"]["failed_count"], 0)

    def test_predictions_jsonl_can_use_actual_items(self):
        predictions = self.full_predictions()
        predictions[0]["actual_items"] = predictions[0].pop("items")
        result = self.run_eval(predictions)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["summary"]["failed_count"], 0)

    def test_intent_with_batch_eval_case_id_passes(self):
        intent = self.base_intent(
            eval_case_id="domain-concept-dtensor",
            items=[
                {
                    "id": "item-1",
                    "title": "DTensor",
                    "summary": "Domain concept.",
                    "category": "domain",
                    "destination": "wiki-stage",
                    "confidence": "medium",
                    "review_required": True,
                    "suggested_action": "stage-wiki-note",
                    "reason": "Domain concept belongs in wiki.",
                }
            ],
        )
        result = self.run_intent_eval(intent, check=False)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 1)
        case = [item for item in report["results"] if item["id"] == "domain-concept-dtensor"][0]
        self.assertEqual(case["status"], "pass")
        self.assertEqual(len(report["prediction_sources"]), 1)
        self.assertTrue(report["prediction_sources"][0].endswith("intent.json"))

    def test_intent_with_item_eval_case_id_passes(self):
        intent = self.base_intent(
            items=[
                {
                    "id": "item-1",
                    "eval_case_id": "domain-concept-dtensor",
                    "title": "DTensor",
                    "summary": "Domain concept.",
                    "category": "domain",
                    "destination": "wiki-stage",
                    "confidence": "medium",
                    "review_required": True,
                    "suggested_action": "stage-wiki-note",
                    "reason": "Domain concept belongs in wiki.",
                }
            ],
        )
        result = self.run_intent_eval(intent, check=False)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 1)
        case = [item for item in report["results"] if item["id"] == "domain-concept-dtensor"][0]
        self.assertEqual(case["status"], "pass")

    def test_intent_without_eval_case_id_is_invalid_input(self):
        intent = self.base_intent(
            items=[
                {
                    "id": "item-1",
                    "title": "DTensor",
                    "summary": "Domain concept.",
                    "category": "domain",
                    "destination": "wiki-stage",
                    "confidence": "medium",
                    "review_required": True,
                    "suggested_action": "stage-wiki-note",
                    "reason": "Domain concept belongs in wiki.",
                }
            ],
        )
        result = self.run_intent_eval(intent, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("eval_case_id", result.stderr)

    def test_intent_item_eval_case_id_must_be_non_empty_string(self):
        for value in (123, ""):
            with self.subTest(value=value):
                intent = self.base_intent(items=[self.valid_intent_item(eval_case_id=value)])
                result = self.run_intent_eval(intent, check=False)
                self.assertEqual(result.returncode, 2)
                self.assertIn("eval_case_id", result.stderr)

    def test_intent_item_without_eval_case_id_rejected_when_no_batch_mapping(self):
        intent = self.base_intent(
            items=[
                self.valid_intent_item(id="item-1", eval_case_id="domain-concept-dtensor"),
                self.valid_intent_item(id="item-2", title="Unmapped DTensor detail"),
            ],
        )
        result = self.run_intent_eval(intent, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("eval_case_id", result.stderr)

    def test_intent_item_metadata_strings_must_be_non_empty(self):
        intent = self.base_intent(
            eval_case_id="domain-concept-dtensor",
            items=[self.valid_intent_item(title="")],
        )
        result = self.run_intent_eval(intent, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("title", result.stderr)

    def test_intent_source_refs_must_be_list(self):
        intent = self.base_intent(
            eval_case_id="domain-concept-dtensor",
            source_refs="not-list",
            items=[self.valid_intent_item()],
        )
        result = self.run_intent_eval(intent, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("source_refs", result.stderr)

    def test_intent_source_refs_entries_must_be_objects(self):
        intent = self.base_intent(
            eval_case_id="domain-concept-dtensor",
            source_refs=[123],
            items=[self.valid_intent_item()],
        )
        result = self.run_intent_eval(intent, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("source_refs", result.stderr)

    def test_intent_source_ref_type_must_be_string(self):
        intent = self.base_intent(
            eval_case_id="domain-concept-dtensor",
            source_refs=[{"type": 123, "ref": "discussion-1", "summary": "A source."}],
            items=[self.valid_intent_item()],
        )
        result = self.run_intent_eval(intent, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertTrue("source_refs" in result.stderr or "type" in result.stderr)

    def test_intent_source_ref_requires_ref(self):
        intent = self.base_intent(
            eval_case_id="domain-concept-dtensor",
            source_refs=[{"type": "conversation", "summary": "A source."}],
            items=[self.valid_intent_item()],
        )
        result = self.run_intent_eval(intent, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("ref", result.stderr)

    def test_intent_item_source_refs_entries_must_be_objects(self):
        intent = self.base_intent(
            eval_case_id="domain-concept-dtensor",
            items=[self.valid_intent_item(source_refs=[123])],
        )
        result = self.run_intent_eval(intent, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("source_refs", result.stderr)

    def test_intent_top_level_string_fields_must_be_non_empty_strings(self):
        for field_name in ("intent_id", "created_at", "workspace", "task_summary"):
            for value in (123, ""):
                with self.subTest(field_name=field_name, value=value):
                    intent = self.base_intent(
                        eval_case_id="domain-concept-dtensor",
                        items=[self.valid_intent_item()],
                    )
                    intent[field_name] = value
                    result = self.run_intent_eval(intent, check=False)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn(field_name, result.stderr)

    def test_malformed_intent_json_is_invalid_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            intent_path = Path(tmp) / "intent.json"
            intent_path.write_text("{not-json}\n", encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(RUNNER),
                    "--golden",
                    str(GOLDEN),
                    "--intent",
                    str(intent_path),
                    "--json",
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("malformed intent artifact JSON", result.stderr)

    def test_duplicate_case_id_across_prediction_and_intent_is_invalid_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            prediction_path = Path(tmp) / "predictions.jsonl"
            intent_path = Path(tmp) / "intent.json"
            self.write_jsonl(
                prediction_path,
                [
                    {
                        "id": "domain-concept-dtensor",
                        "items": [
                            {
                                "category": "domain",
                                "destination": "wiki-stage",
                                "review_required": True,
                                "suggested_action": "stage-wiki-note",
                            }
                        ],
                    }
                ],
            )
            self.write_intent(
                intent_path,
                self.base_intent(
                    eval_case_id="domain-concept-dtensor",
                    items=[
                        {
                            "id": "item-1",
                            "title": "DTensor",
                            "summary": "Domain concept.",
                            "category": "domain",
                            "destination": "wiki-stage",
                            "confidence": "medium",
                            "review_required": True,
                            "suggested_action": "stage-wiki-note",
                            "reason": "Domain concept belongs in wiki.",
                        }
                    ],
                ),
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(RUNNER),
                    "--golden",
                    str(GOLDEN),
                    "--predictions",
                    str(prediction_path),
                    "--intent",
                    str(intent_path),
                    "--json",
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("duplicate prediction id across sources", result.stderr)

    def test_prediction_enum_value_type_error_is_invalid_input(self):
        result = self.run_eval(
            [{"id": "domain-concept-dtensor", "items": [{"category": []}]}],
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid category", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_intent_enum_value_type_error_is_invalid_input(self):
        intent = self.base_intent(
            eval_case_id="domain-concept-dtensor",
            items=[self.valid_intent_item(category=[])],
        )
        result = self.run_intent_eval(intent, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid category", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_intent_item_eval_case_id_groups_items_into_one_case(self):
        intent = self.base_intent(
            items=[
                {
                    "id": "item-1",
                    "eval_case_id": "mixed-router-boundary",
                    "title": "Router write boundary",
                    "summary": "Router should not execute writes.",
                    "category": "meta",
                    "destination": "pamem-experience",
                    "confidence": "medium",
                    "review_required": False,
                    "suggested_action": "append-experience",
                    "reason": "Reusable workflow guidance belongs in memory.",
                },
                {
                    "id": "item-2",
                    "eval_case_id": "mixed-router-boundary",
                    "title": "Intent batch schema",
                    "summary": "Intent artifacts use independently routed items.",
                    "category": "domain",
                    "destination": "wiki-stage",
                    "confidence": "medium",
                    "review_required": True,
                    "suggested_action": "stage-wiki-note",
                    "reason": "Domain design knowledge belongs in wiki.",
                },
            ],
        )
        result = self.run_intent_eval(intent, check=False)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 1)
        case = [item for item in report["results"] if item["id"] == "mixed-router-boundary"][0]
        self.assertEqual(case["status"], "pass")
        self.assertEqual(len(case["predicted_items"]), 2)


if __name__ == "__main__":
    unittest.main()
