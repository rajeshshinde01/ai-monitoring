from app.observability import AlertEngine, Pod, _mask_sensitive_log_content, _quantity_to_mib, analyse_logs, answer_operations_question, dashboard_snapshot, structure_logs


def test_memory_quantity_supports_kubernetes_milli_bytes():
    assert round(_quantity_to_mib("70058325333m"), 3) == 66.813


def test_log_analysis_detects_critical_signals():
    result = analyse_logs(["ERROR process terminated reason=OOMKilled", "WARN CrashLoopBackOff"])
    assert result["severity"] == "critical"
    assert result["counts"]["oom_events"] == 1


class FakeClient:
    target = "docker"

    def pods(self):
        return [Pod("mindspark-api", "local-docker", "Running", 0, 900, 1000, 450, 512, "local-machine")]

    def logs(self, pods):
        return {"mindspark-api": ["ERROR timeout while calling service"]}


def test_snapshot_contains_pods_and_forecasts_without_docker():
    snapshot = dashboard_snapshot(FakeClient())
    assert snapshot["summary"]["pods"] > 0
    assert len(snapshot["forecasts"]) == snapshot["summary"]["pods"]
    assert snapshot["structured_logs"]["mindspark-api"][0]["level"] == "error"
    assert snapshot["summary"]["running_pods"] == 1


def test_structured_logs_preserves_raw_content_and_severity():
    records = structure_logs(["2026-08-06T10:00:00Z INFO startup complete", "WARN connection slow"])
    assert records[0]["timestamp"] == "2026-08-06T10:00:00Z"
    assert records[0]["level"] == "info"
    assert records[1]["level"] == "warning"
    assert records[1]["raw"] == "WARN connection slow"


def test_structured_logs_masks_common_secrets():
    assert "[REDACTED]" in _mask_sensitive_log_content("password=hunter2 token=abc123")


def test_alert_engine_persists_and_evaluates_rules(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    engine = AlertEngine()
    snapshot = dashboard_snapshot(FakeClient())
    active = engine.evaluate(snapshot)
    assert any(event["rule_id"] == "cpu-high" for event in active)
    assert engine.history()[0]["state"] == "active"


def test_alert_engine_creates_and_evaluates_log_pattern_rule(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    engine = AlertEngine()
    rule = engine.create_pattern_rule({"name": "Timeout spike", "pattern": "timeout", "threshold": 1})
    snapshot = dashboard_snapshot(FakeClient())
    snapshot["logs"]["mindspark-api"] = ["ERROR timeout while calling service"]
    active = engine.evaluate(snapshot)
    assert any(event["rule_id"] == rule["id"] for event in active)


def test_operations_assistant_uses_live_snapshot_without_exposing_raw_logs():
    snapshot = dashboard_snapshot(FakeClient())
    answer = answer_operations_question(snapshot, "What errors are in mindspark-api logs?")
    assert "mindspark-api" in answer["answer"]
    assert answer["mode"] == "python-operations-intelligence"
    assert any(item["kind"] == "log" for item in answer["evidence"])
    assert "Live workload telemetry" in answer["sources"]


def test_operations_assistant_keeps_broad_navigation_questions_concise():
    snapshot = dashboard_snapshot(FakeClient())
    answer = answer_operations_question(snapshot, "Tell me about the saved tabs")
    assert answer["evidence"] == []
    assert "saved dashboard views" in answer["answer"]


def test_operations_assistant_answers_pod_and_deployment_counts():
    snapshot = dashboard_snapshot(FakeClient())
    pod_answer = answer_operations_question(snapshot, "How many pods are running?")
    deployment_answer = answer_operations_question(snapshot, "How many deployments are running?")
    assert "1 of 1 pods" in pod_answer["answer"]
    assert "deployments/workloads" in deployment_answer["answer"]


def test_operations_assistant_checks_deployment_issues_cluster_wide():
    snapshot = dashboard_snapshot(FakeClient())
    answer = answer_operations_question(snapshot, "Is there any deployment issue?", "mindspark-api")
    assert "deployment readiness issue" in answer["answer"]


def test_operations_intelligence_expands_database_to_postgres_evidence():
    snapshot = dashboard_snapshot(FakeClient())
    answer = answer_operations_question(snapshot, "Is there a database issue?")
    assert answer["mode"] == "python-operations-intelligence"
    assert "mindspark-api" in answer["answer"]
