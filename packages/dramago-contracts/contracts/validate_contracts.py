"""Stdlib-only offline P0 fixture checks, not full JSON Schema validation.

Checks deterministic structure, immutable references and fixture digests.
The separate Node P0 gate validates instances for the current schema vocabulary,
not full Draft 2020-12. This suite owns selected cross-record semantic fixtures.
This is not a business runtime or authorization service.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parent
SCHEMAS = (
    "common", "drama-project", "artifact-version", "approval-decision",
    "planning-baseline", "script-baseline", "creative-run", "media-execution-link",
)
EXAMPLES = {
    "project": "drama-project", "artifact": "artifact-version",
    "planning-baseline": "planning-baseline", "script-baseline": "script-baseline",
    "approval": "approval-decision", "run": "creative-run",
    "media-execution-link": "media-execution-link",
}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f"Not a JSON number: {value}")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"),
                      object_pairs_hook=unique_object, parse_constant=reject_constant)


def check_string(value, definition):
    """Check only the shared lexical definitions used by the fixtures."""
    if not isinstance(value, str):
        raise AssertionError("Expected a string")
    if "pattern" in definition and re.search(definition["pattern"], value) is None:
        raise AssertionError(f"Invalid lexical value: {value!r}")
    excluded = definition.get("not", {})
    if value in excluded.get("enum", ()):
        raise AssertionError(f"Reserved identity: {value!r}")
    if "pattern" in excluded and re.search(excluded["pattern"], value):
        raise AssertionError(f"Mutable version alias: {value!r}")


class FixtureStructure:
    """Small structural smoke check, deliberately NOT a JSON Schema engine.

    Walks local common definitions, object fields, array items and allOf shapes.
    Checks basic types, required/unknown fields, const/enum and shared lexemes.
    This walker alone does not cover formats, conditionals, dependencies, bounds
    or uniqueness. Run the separate Node gate for current-schema instance
    validation. Neither checker implements full Draft 2020-12 meta-schema
    validation. Tests below cover selected cross-record invariants separately.
    """

    def __init__(self, schema, common):
        self.schema = schema
        self.common = common

    def check(self, value, shape=None):
        shape = self.schema if shape is None else shape
        if "$ref" in shape:
            prefix = "common.schema.json#/$defs/"
            ref = shape["$ref"]
            if not ref.startswith(prefix) or ref[len(prefix):] not in self.common["$defs"]:
                raise AssertionError(f"Unsupported local fixture reference: {ref}")
            self.check(value, self.common["$defs"][ref[len(prefix):]])
        expected = shape.get("type")
        types = {"object": dict, "array": list, "string": str, "integer": int,
                 "boolean": bool, "null": type(None)}
        if isinstance(expected, str) and expected in types and type(value) is not types[expected]:
            raise AssertionError(f"Expected {expected}")
        if "const" in shape and value != shape["const"]:
            raise AssertionError("Unexpected constant")
        if "enum" in shape and value not in shape["enum"]:
            raise AssertionError("Unexpected enum value")
        if expected == "string":
            check_string(value, shape)
        if isinstance(value, dict):
            properties = shape.get("properties", {})
            missing = set(shape.get("required", ())) - value.keys()
            if missing:
                raise AssertionError(f"Missing fields: {sorted(missing)}")
            if shape.get("additionalProperties") is False and value.keys() - properties.keys():
                raise AssertionError("Unexpected fields")
            for key in sorted(value.keys() & properties.keys()):
                self.check(value[key], properties[key])
        if isinstance(value, list) and "items" in shape:
            for item in value:
                self.check(item, shape["items"])
        for part in shape.get("allOf", ()):
            self.check(value, part)

    def accepts_structure(self, value):
        try:
            self.check(value)
        except AssertionError:
            return False
        return True


class ContractTests(unittest.TestCase):
    def test_schema_inventory(self):
        for name in SCHEMAS:
            with self.subTest(schema=name):
                self.assertTrue((ROOT / f"{name}.schema.json").is_file(), name)

    def test_example_inventory(self):
        for name in (*EXAMPLES, "script-approval", "supporting-artifacts"):
            with self.subTest(example=name):
                self.assertTrue((ROOT / "examples" / f"{name}.json").is_file(), name)

    def test_schema_definitions(self):
        schemas = [read_json(ROOT / f"{name}.schema.json") for name in SCHEMAS]
        self.assertEqual(len({s["$id"] for s in schemas}), len(SCHEMAS))
        for schema in schemas:
            self.assertIsInstance(schema, dict)
            self.assertTrue(schema["$id"].startswith("https://schemas.dramago.invalid/p0/v1/"))
            self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")

    def test_reference_lexical_boundaries(self):
        common = read_json(ROOT / "common.schema.json")
        for name, valid in (("artifact_id", "art_example"), ("version_id", "av_example"),
                            ("content_digest", "sha256:" + "a" * 64),
                            ("stable_id", "project_example"), ("policy_version", "policy/v1")):
            check_string(valid, common["$defs"][name])
            with self.subTest(definition=name), self.assertRaises(AssertionError):
                check_string(valid + "\n", common["$defs"][name])

    def test_fixture_digest_subset_is_fail_closed(self):
        for value in (1.0, 9007199254740992, {"\u00e9": "non-ASCII key"}, "\ud800"):
            with self.subTest(value=repr(value)), self.assertRaises(ValueError):
                content_digest(value)
        self.assertEqual(content_digest({"unicode_text": "\u00e9"}),
                         "sha256:" + hashlib.sha256(b'{"unicode_text":"\xc3\xa9"}').hexdigest())

    def test_json_loader_rejects_duplicate_keys_and_non_json_numbers(self):
        class Input:
            def __init__(self, text):
                self.text = text

            def read_text(self, encoding):
                return self.text

        for text in ('{"version_id":"av_a","version_id":"av_b"}', 'NaN', 'Infinity'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                read_json(Input(text))

    def test_reference_contract(self):
        common = read_json(ROOT / "common.schema.json")
        validator = FixtureStructure(common["$defs"]["artifact_ref"], common)
        valid = {"artifact_id": "art_outline", "version_id": "av_outline_1",
                 "content_digest": "sha256:" + "a" * 64}
        validator.check(valid)
        for field in valid:
            invalid = dict(valid)
            del invalid[field]
            with self.subTest(missing=field):
                self.assertFalse(validator.accepts_structure(invalid))
        for version in (1, "1", "latest", "av_latest", "av_LaTeSt", "av_current",
                        "av_CURRENT", "av_CuRrEnT", "av_HeAd", "job.version"):
            with self.subTest(version=version):
                self.assertFalse(validator.accepts_structure({**valid, "version_id": version}))
        for extra in ({"job.version": 1}, {"version": 1}, {"latest": True}):
            self.assertFalse(validator.accepts_structure({**valid, **extra}))


def check_fixture_subset(value):
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, str):
        value.encode("utf-8")
        return
    if isinstance(value, int) and abs(value) <= 9007199254740991:
        return
    if isinstance(value, list):
        for item in value:
            check_fixture_subset(item)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or not key.isascii():
                raise ValueError("Fixture digest keys must be ASCII strings")
            check_fixture_subset(item)
        return
    raise ValueError("Outside the fixture-only canonical JSON subset")


def content_digest(value):
    check_fixture_subset(value)
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def artifact_ref(record):
    return {key: record[key] for key in ("artifact_id", "version_id", "content_digest")}


def reference_paths(value, path=()):
    if isinstance(value, dict):
        if set(value) == {"artifact_id", "version_id", "content_digest"}:
            yield path, value
        else:
            for key, child in value.items():
                yield from reference_paths(child, (*path, key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from reference_paths(child, (*path, index))


class FixtureTests(unittest.TestCase):
    """Executable acceptance vectors, not reusable P1 domain/persistence code."""

    @classmethod
    def setUpClass(cls):
        schemas = [read_json(ROOT / f"{name}.schema.json") for name in SCHEMAS]
        common = schemas[0]
        cls.validators = {
            name: FixtureStructure(schema, common)
            for name, schema in zip(SCHEMAS, schemas)
        }
        cls.examples = {
            name: read_json(ROOT / "examples" / f"{name}.json")
            for name in (*EXAMPLES, "script-approval", "supporting-artifacts")
        }
        cls.records = [value for name, value in cls.examples.items()
                       if name != "supporting-artifacts"] + cls.examples["supporting-artifacts"]
        cls.by_version = {
            (r["artifact_id"], r["version_id"]): r
            for r in cls.records if "artifact_id" in r
        }

    def resolve(self, reference):
        key = reference["artifact_id"], reference["version_id"]
        self.assertIn(key, self.by_version, f"Unresolved immutable reference: {key}")
        record = self.by_version[key]
        self.assertEqual(artifact_ref(record), reference)
        return record

    def assert_scope(self, record, scope):
        actual = record.get("manifest", record)
        for key in ("project_id", "workspace_id"):
            self.assertEqual(actual[key], scope[key], key)

    def assert_planning_coverage(self, baseline):
        manifest = baseline["manifest"]
        range_record = self.resolve(manifest["range_definition_ref"])
        self.assertEqual(range_record["kind"], "planning_range")
        self.assert_scope(range_record, manifest)
        declared = range_record["content"]
        self.assert_scope(declared, manifest)
        self.assertEqual(declared["range_id"], manifest["range_id"])
        actual_ids = [e["episode_id"] for e in manifest["ordered_episodes"]]
        self.assertEqual(actual_ids, declared["ordered_episode_ids"], "Exact frozen range coverage/order")
        self.assertEqual(len(actual_ids), len(set(actual_ids)), "Duplicate episode identity")
        for episode in manifest["ordered_episodes"]:
            outline = self.resolve(episode["outline_ref"])
            self.assertEqual(outline["kind"], "episode_outline")
            self.assertEqual(outline["episode_id"], episode["episode_id"])
            self.assert_scope(outline, manifest)

    def assert_review(self, evidence, subjects, outcome, kind):
        self.assertEqual(evidence["outcome"], outcome)
        self.assertCountEqual(evidence["subject_refs"], subjects)
        report = self.resolve(evidence["evidence_ref"])
        self.assertEqual(report["kind"], "review_report")
        self.assertEqual(report["content"]["review_kind"], kind)
        self.assertEqual(report["content"]["outcome"], outcome)
        self.assertCountEqual(report["content"]["subject_refs"], subjects)
        return report["content"]

    def assert_approval(self, baseline, decision):
        self.assertEqual(decision["decision"], "approved")
        self.assertIn(artifact_ref(baseline), decision["target_refs"])
        self.assertIn(artifact_ref(decision), baseline["approval_refs"])
        self.assert_scope(decision, baseline["manifest"])
        self.assertIn(decision["actor"]["actor_type"], ("human", "service_authorized"))
        authorization = self.resolve(decision["actor"]["authorization_ref"])
        self.assertEqual(authorization["kind"], "authorization_evidence")
        self.assertEqual(authorization["content"]["actor_id"], decision["actor"]["actor_id"])

    def assert_script_binding(self, baseline):
        manifest = baseline["manifest"]
        planning = self.resolve(manifest["planning_baseline_ref"])
        self.assertEqual(planning["planning_baseline_id"], manifest["planning_baseline_id"])
        self.assert_scope(planning, manifest)
        episode = next(e for e in planning["manifest"]["ordered_episodes"]
                       if e["episode_id"] == manifest["episode_id"])
        self.assertEqual(episode["outline_ref"], manifest["episode_outline"])
        screenplay = self.resolve(manifest["screenplay"])
        self.assertEqual(screenplay["kind"], "screenplay")
        self.assertEqual(screenplay["episode_id"], manifest["episode_id"])
        self.assert_scope(screenplay, manifest)
        doctor = self.assert_review(manifest["doctor_evidence"], [manifest["screenplay"]],
                                    "PASS", "script_doctor")
        self.assertIs(doctor["mandatory_fail"], False)
        continuity = self.assert_review(manifest["continuity_evidence"], [manifest["screenplay"]],
                                        "CLEAR", "script_continuity")
        self.assertEqual(continuity["input_ref"], manifest["continuity_input"])
        self.assertEqual(continuity["output_ref"], manifest["continuity_output"])

    def assert_run_inputs(self, run):
        self.assertEqual(content_digest(run["input_manifest"]), run["input_manifest_digest"])
        step_ids = [step["step_id"] for step in run["steps"]]
        self.assertEqual(len(step_ids), len(set(step_ids)))
        for step in run["steps"]:
            attempts = [attempt["attempt"] for attempt in step["attempts"]]
            self.assertEqual(attempts, sorted(set(attempts)), "Unique ordered attempts")
            for attempt in step["attempts"]:
                self.assertEqual(attempt["input_manifest_digest"], run["input_manifest_digest"])

    def test_all_json_files_and_examples(self):
        paths = list(ROOT.rglob("*.json"))
        self.assertEqual(set(paths), {ROOT / f"{name}.schema.json" for name in SCHEMAS}
                         | {ROOT / "examples" / f"{name}.json" for name in self.examples}
                         | {ROOT / "tool-catalog.v1.json"})
        for path in paths:
            read_json(path)
        for record in self.records:
            name = record["schema_version"].removeprefix("dramago.").removesuffix("/v1")
            with self.subTest(schema=name, record=record.get("artifact_id")):
                self.validators[name].check(record)
                for required in self.validators[name].schema["required"]:
                    broken = deepcopy(record)
                    del broken[required]
                    self.assertFalse(self.validators[name].accepts_structure(broken), required)

    def test_all_references_resolve_with_exact_digest(self):
        self.assertEqual(len(self.by_version), sum("artifact_id" in r for r in self.records))
        for record in self.records:
            for path, reference in reference_paths(record):
                with self.subTest(path=path):
                    resolved = self.resolve(reference)
                    scope = record.get("manifest", record.get("execution_intent", record))
                    self.assert_scope(resolved, scope)

    def test_content_digests(self):
        for record in self.records:
            kind = record["schema_version"]
            if kind == "dramago.artifact-version/v1":
                self.assertEqual(content_digest(record["content"]), record["content_digest"])
            elif kind in ("dramago.planning-baseline/v1", "dramago.script-baseline/v1"):
                self.assertEqual(content_digest(record["manifest"]), record["content_digest"])
            elif kind == "dramago.approval-decision/v1":
                body = {k: v for k, v in record.items() if k not in artifact_ref(record)}
                self.assertEqual(content_digest(body), record["content_digest"])
        link = self.examples["media-execution-link"]
        self.assertEqual(content_digest(link["execution_intent"]), link["intent_digest"])

    def test_frozen_planning_range_and_review(self):
        baseline = self.examples["planning-baseline"]
        self.assert_planning_coverage(baseline)
        m = baseline["manifest"]
        subjects = [m[k] for k in ("range_definition_ref", "story_foundation", "story_bible",
                                    "master_outline", "season_architecture")]
        subjects += [e["outline_ref"] for e in m["ordered_episodes"]]
        for evidence in m["review_evidence"]:
            report = self.assert_review(evidence, subjects, "PASS", "planning")
            self.assertEqual(report["blockers"], [])
        project_range = self.examples["project"]["planning_range"]
        self.assertEqual(project_range["definition_ref"], m["range_definition_ref"])
        self.assertEqual(project_range["ordered_episode_ids"],
                         [e["episode_id"] for e in m["ordered_episodes"]])
        self.assert_approval(baseline, self.examples["approval"])

    def test_script_gates_bind_same_screenplay(self):
        self.assert_script_binding(self.examples["script-baseline"])
        self.assert_approval(self.examples["script-baseline"], self.examples["script-approval"])

    def test_fixed_run_and_media_intent(self):
        self.assert_run_inputs(self.examples["run"])
        intent = self.examples["media-execution-link"]["execution_intent"]
        baseline = self.resolve(intent["script_baseline_ref"])
        self.assertEqual(baseline["script_baseline_id"], intent["script_baseline_id"])
        self.assertEqual(self.resolve(intent["production_plan_ref"])["kind"], "asset_generation_plan")
        self.assertEqual(intent["operation"], "generate_image")
        link = self.examples["media-execution-link"]
        receipt = self.resolve(link["budget_authorization_ref"])["content"]
        self.assertEqual(receipt["quote_id"], link["quote_id"])
        self.assertEqual(receipt["evidence_kind"], "external_budget_authorization_receipt")

    def test_baselines_reject_unversioned_references(self):
        for name in ("planning-baseline", "script-baseline"):
            for path, _ in reference_paths(self.examples[name]):
                for mutation in ("missing_digest", "latest", "job_version"):
                    broken = deepcopy(self.examples[name])
                    target = broken
                    for part in path:
                        target = target[part]
                    if mutation == "missing_digest":
                        del target["content_digest"]
                    else:
                        target["version_id"] = "latest" if mutation == "latest" else 1
                    with self.subTest(schema=name, path=path, mutation=mutation):
                        self.assertFalse(self.validators[name].accepts_structure(broken))

    def test_missing_outline_fails_structure(self):
        broken = deepcopy(self.examples["planning-baseline"])
        del broken["manifest"]["ordered_episodes"][0]["outline_ref"]
        self.assertFalse(self.validators["planning-baseline"].accepts_structure(broken))

    def test_partial_duplicate_reordered_or_foreign_range_fails(self):
        for mutation in ("partial", "duplicate", "reordered", "foreign", "wrong_outline"):
            broken = deepcopy(self.examples["planning-baseline"])
            m = broken["manifest"]
            if mutation == "partial":
                m["ordered_episodes"].pop()
            elif mutation == "duplicate":
                m["ordered_episodes"][1]["episode_id"] = m["ordered_episodes"][0]["episode_id"]
            elif mutation == "reordered":
                m["ordered_episodes"].reverse()
            elif mutation == "foreign":
                m["project_id"] = "project_other"
            else:
                m["ordered_episodes"][0]["outline_ref"] = m["ordered_episodes"][1]["outline_ref"]
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                self.assert_planning_coverage(broken)

    def test_wrong_script_version_or_review_subject_fails(self):
        for field in ("screenplay", "episode_outline", "planning_baseline_id", "doctor_evidence"):
            broken = deepcopy(self.examples["script-baseline"])
            if field == "planning_baseline_id":
                broken["manifest"][field] = "pb_other"
            elif field == "doctor_evidence":
                broken["manifest"][field]["subject_refs"] = [artifact_ref(self.examples["artifact"])]
            else:
                broken["manifest"][field] = artifact_ref(self.examples["artifact"])
                if field == "episode_outline":
                    broken["manifest"][field]["version_id"] = "av_other"
            with self.subTest(field=field), self.assertRaises(AssertionError):
                self.assert_script_binding(broken)

    def test_review_is_not_approval(self):
        validator = self.validators["approval-decision"]
        for actor_type in ("model", "reviewer", "service"):
            broken = deepcopy(self.examples["approval"])
            broken["actor"]["actor_type"] = actor_type
            self.assertFalse(validator.accepts_structure(broken))
        broken = deepcopy(self.examples["approval"])
        del broken["actor"]["authorization_ref"]
        self.assertFalse(validator.accepts_structure(broken))
        for target in ({"artifact_id": "art_any"}, {"artifact_id": "art_any", "version_id": "av_any"}):
            broken = deepcopy(self.examples["approval"])
            broken["target_refs"] = [target]
            self.assertFalse(validator.accepts_structure(broken))
        broken = deepcopy(self.examples["approval"])
        broken["target_refs"][0]["content_digest"] = "sha256:" + "0" * 64
        with self.assertRaises(AssertionError):
            self.assert_approval(self.examples["planning-baseline"], broken)

    def test_nonpassing_script_evidence_fails_structure(self):
        for field, outcome in (("doctor_evidence", "FAIL"), ("doctor_evidence", "CLEAR"),
                               ("continuity_evidence", "BLOCKED"), ("continuity_evidence", "PASS")):
            broken = deepcopy(self.examples["script-baseline"])
            broken["manifest"][field]["outcome"] = outcome
            self.assertFalse(self.validators["script-baseline"].accepts_structure(broken))

    def test_run_rejects_changed_input_or_duplicate_attempt(self):
        for mutation in ("digest", "attempt"):
            broken = deepcopy(self.examples["run"])
            attempts = broken["steps"][0]["attempts"]
            if mutation == "digest":
                attempts[0]["input_manifest_digest"] = "sha256:" + "0" * 64
            else:
                attempts.append({**attempts[0], "status": "failed"})
            with self.assertRaises(AssertionError):
                self.assert_run_inputs(broken)

    def test_media_link_does_not_write_media_or_adoption_state(self):
        validator = self.validators["media-execution-link"]
        for extra in ({"job_state": "succeeded"}, {"job_version": 1},
                      {"creative_status": "approved"}, {"adopted": True}):
            self.assertFalse(validator.accepts_structure({**self.examples["media-execution-link"], **extra}))
        prepared = deepcopy(self.examples["media-execution-link"])
        for field in ("quote_id", "media_job_id", "budget_authorization_ref"):
            del prepared[field]
        prepared["media_asset_ids"] = []
        validator.check(prepared)


if __name__ == "__main__":
    unittest.main(verbosity=2)
