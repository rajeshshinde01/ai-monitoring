from contextlib import asynccontextmanager, suppress
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
import asyncio
from pathlib import Path
from urllib.parse import urlparse
from typing import Any
import ipaddress
import socket
from uuid import uuid4
import time
import httpx
import requests
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware
from authlib.integrations.starlette_client import OAuth

from app.observability import AlertEngine, AlertNotifier, ClusterClient, ClusterConnectionError, TelemetryCollector, answer_operations_question, structure_logs
from app.auth import AccountLockedError, LocalAuth


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
client = ClusterClient()
alerts = AlertEngine()
notifier = AlertNotifier()
collector = TelemetryCollector(client, alerts, notifier)
auth = LocalAuth(DATA_DIR)


@asynccontextmanager
async def lifespan(_: FastAPI):
    collector.start()
    url_monitor_task = asyncio.create_task(_url_monitor_poll_loop())
    try:
        yield
    finally:
        url_monitor_task.cancel()
        with suppress(asyncio.CancelledError):
            await url_monitor_task
        collector.stop()


app = FastAPI(title="L1ControlScope", version="1.1.0", lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=os.getenv("AUTH_SESSION_SECRET", "local-development-only-change-me"), https_only=os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true", same_site="lax")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
oauth = OAuth()


def _oidc_ready() -> bool:
    return all(os.getenv(name, "").strip() for name in ("OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URL"))


def _oidc_client():
    if not _oidc_ready():
        raise HTTPException(status_code=503, detail="OIDC is not configured. Continue with local sign-in.")
    issuer = os.environ["OIDC_ISSUER_URL"].rstrip("/")
    oauth.register(
        name="company_oidc",
        client_id=os.environ["OIDC_CLIENT_ID"],
        client_secret=os.environ["OIDC_CLIENT_SECRET"],
        server_metadata_url=f"{issuer}/.well-known/openid-configuration",
        client_kwargs={"scope": "openid profile email"},
    )
    return oauth.create_client("company_oidc")


@app.middleware("http")
async def require_login_for_dashboard_api(request: Request, call_next):
    path = request.url.path
    request.state.user = auth.current_user(request.cookies.get("pulseops_session"))
    if path.startswith("/api/") and not path.startswith("/api/auth/"):
        if not request.state.user:
            return JSONResponse(status_code=401, content={"detail": "Sign in to use L1ControlScope."})
    response = await call_next(request)
    if path == "/" or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def require_administrator(request: Request) -> dict[str, str]:
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "administrator":
        raise HTTPException(status_code=403, detail="Administrator access is required for this change.")
    return user


def require_developer_or_administrator(request: Request) -> dict[str, str]:
    user = getattr(request.state, "user", None)
    if not user or user.get("role") not in {"administrator", "developer"}:
        raise HTTPException(status_code=403, detail="Developer / Operator or Administrator access is required for this feature.")
    return user


def snapshot_for_user(snapshot: dict[str, Any], user: dict[str, str] | None) -> dict[str, Any]:
    """Remove log-level evidence for read-only users before any feature uses it."""
    if user and user.get("role") != "readonly":
        return snapshot
    restricted = deepcopy(snapshot)
    restricted["logs"] = {}
    restricted["structured_logs"] = {}
    restricted["incident_evidence"] = []
    restricted["analysis"] = {
        pod["name"]: {
            "severity": "healthy",
            "counts": {"errors": 0, "warnings": 0, "oom_events": 0},
            "findings": ["Log-level evidence is available to Developer / Operator and Administrator accounts."],
        }
        for pod in restricted.get("pods", [])
    }
    return restricted


class AlertRuleUpdate(BaseModel):
    enabled: bool
    threshold: float = Field(ge=0)
    sustain_minutes: int = Field(default=0, ge=0, le=60)
    scope_type: str = Field(default="all", pattern="^(all|pod|name_contains)$")
    scope_value: str = Field(default="", max_length=253)


class AlertAcknowledgementUpdate(BaseModel):
    key: str = Field(min_length=3, max_length=600)
    status: str = Field(default="acknowledged", pattern="^(acknowledged|investigating)$")
    note: str = Field(default="", max_length=500)


class NotificationSettingsUpdate(BaseModel):
    enabled: bool = False


class AlertRuleCreate(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    metric: str = Field(pattern="^(memory_percent|cpu_percent|restarts|errors)$")
    threshold: float = Field(ge=0)
    sustain_minutes: int = Field(default=0, ge=0, le=60)
    severity: str = Field(default="warning", pattern="^(warning|critical)$")
    scope_type: str = Field(default="all", pattern="^(all|pod|name_contains)$")
    scope_value: str = Field(default="", max_length=253)


class LocalLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class LocalRegisterRequest(LocalLoginRequest):
    name: str = Field(default="", max_length=100)


class UserStatusUpdate(BaseModel):
    enabled: bool


class UserRoleUpdate(BaseModel):
    role: str = Field(pattern="^(administrator|developer|readonly)$")


class LogPatternAlertCreate(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    pattern: str = Field(min_length=3, max_length=300)
    threshold: float = Field(default=3, ge=1)
    severity: str = "warning"


class AssistantQuestion(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    current_pod: str | None = Field(default=None, max_length=253)


class OllamaSettingsUpdate(BaseModel):
    enabled: bool = False
    base_url: str = Field(default="http://ollama:11434", min_length=10, max_length=200)
    model: str = Field(default="llama3.2:3b", min_length=1, max_length=100)


class SplunkSettingsUpdate(BaseModel):
    enabled: bool = False
    base_url: str = Field(default="", max_length=240)
    index: str = Field(default="main", min_length=1, max_length=120)
    pod_field: str = Field(default="kubernetes.pod_name", min_length=1, max_length=120)
    scope_field: str = Field(default="kubernetes.namespace", max_length=120)
    scope_value: str = Field(default="", max_length=180)
    lookback_minutes: int = Field(default=15, ge=15, le=43200)


class PrometheusSettingsUpdate(BaseModel):
    enabled: bool = True
    base_url: str = Field(default="", max_length=240)


class UrlMonitorCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    environment: str = Field(pattern="^(dev|qa|uat|prod)$")
    url: str = Field(min_length=8, max_length=500)
    health_path: str = Field(default="", max_length=200)
    expected_status: int = Field(default=200, ge=100, le=599)
    enabled: bool = True


class UrlMonitorUpdate(UrlMonitorCreate):
    pass


class IncidentWorkspaceCreate(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    note: str = Field(default="", max_length=1000)
    pod: str | None = Field(default=None, max_length=253)
    severity: str = Field(default="warning", pattern="^(healthy|warning|critical)$")


class IncidentWorkspaceUpdate(BaseModel):
    status: str = Field(pattern="^(open|monitoring|resolved)$")
    note: str = Field(default="", max_length=1000)


def _workspaces_file() -> Path:
    return DATA_DIR / "incident-workspaces.json"


def _read_workspaces() -> list[dict]:
    try:
        content = json.loads(_workspaces_file().read_text())
        return content if isinstance(content, list) else []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def _write_workspaces(workspaces: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _workspaces_file().write_text(json.dumps(workspaces[-100:], indent=2) + "\n")


def _audit_file() -> Path:
    return DATA_DIR / "audit-events.json"


def _read_audit_events() -> list[dict[str, Any]]:
    try:
        value = json.loads(_audit_file().read_text())
        return value if isinstance(value, list) else []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def _audit(action: str, actor: dict[str, str], target: str, details: dict[str, Any] | None = None) -> None:
    """Persist a small, secret-free trail of administrator changes."""
    from datetime import datetime, timezone
    from uuid import uuid4

    safe_details = {key: value for key, value in (details or {}).items() if "secret" not in key.lower() and "password" not in key.lower() and "token" not in key.lower()}
    events = _read_audit_events()
    events.append({"id": str(uuid4()), "timestamp": datetime.now(timezone.utc).isoformat(), "actor": actor.get("email", "unknown"), "action": action, "target": target, "details": safe_details})
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _audit_file().write_text(json.dumps(events[-1000:], indent=2) + "\n")


def _alert_acknowledgements_file() -> Path:
    return DATA_DIR / "alert-acknowledgements.json"


def _read_alert_acknowledgements() -> dict[str, dict[str, str]]:
    try:
        value = json.loads(_alert_acknowledgements_file().read_text())
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _write_alert_acknowledgements(records: dict[str, dict[str, str]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _alert_acknowledgements_file().write_text(json.dumps(records, indent=2) + "\n")


def _ollama_settings_file() -> Path:
    return DATA_DIR / "ollama-settings.json"


def _splunk_settings_file() -> Path:
    return DATA_DIR / "splunk-settings.json"


def _prometheus_settings_file() -> Path:
    return DATA_DIR / "prometheus-settings.json"


def _url_monitors_file() -> Path:
    return DATA_DIR / "url-monitors.json"


def _url_monitor_history_file() -> Path:
    return DATA_DIR / "url-monitor-history.json"


def _read_url_monitor_history() -> list[dict[str, Any]]:
    try:
        value = json.loads(_url_monitor_history_file().read_text())
        return value if isinstance(value, list) else []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def _write_url_monitor_history(samples: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _url_monitor_history_file().write_text(json.dumps(samples, separators=(",", ":")) + "\n")


def _retain_url_monitor_history(results: list[dict[str, Any]]) -> None:
    """Persist compact check outcomes for operational trend and incident views."""
    cutoff = datetime.now(timezone.utc).timestamp() - (7 * 24 * 60 * 60)
    retained = []
    for sample in _read_url_monitor_history():
        try:
            if datetime.fromisoformat(str(sample.get("checked_at", "")).replace("Z", "+00:00")).timestamp() >= cutoff:
                retained.append(sample)
        except ValueError:
            continue
    retained.extend({
        "monitor_id": item.get("id"),
        "environment": item.get("environment"),
        "status": item.get("status"),
        "latency_ms": item.get("latency_ms"),
        "status_code": item.get("status_code"),
        "error": item.get("error"),
        "checked_at": item.get("checked_at"),
    } for item in results if item.get("id"))
    _write_url_monitor_history(retained)


def _url_monitor_history_payload(monitors: list[dict[str, Any]], hours: int = 24) -> dict[str, list[dict[str, Any]]]:
    cutoff = datetime.now(timezone.utc).timestamp() - (hours * 60 * 60)
    ids = {item.get("id") for item in monitors}
    grouped: dict[str, list[dict[str, Any]]] = {str(item_id): [] for item_id in ids if item_id}
    for sample in _read_url_monitor_history():
        monitor_id = str(sample.get("monitor_id") or "")
        if monitor_id not in grouped:
            continue
        try:
            observed_at = datetime.fromisoformat(str(sample.get("checked_at", "")).replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        if observed_at >= cutoff:
            grouped[monitor_id].append(sample)
    return grouped


def _read_url_monitors() -> list[dict[str, Any]]:
    try:
        value = json.loads(_url_monitors_file().read_text())
        return value if isinstance(value, list) else []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def _write_url_monitors(monitors: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _url_monitors_file().write_text(json.dumps(monitors, indent=2) + "\n")


def _validated_monitor(update: UrlMonitorCreate) -> dict[str, Any]:
    values = update.model_dump()
    parsed = urlparse(values["url"].strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise HTTPException(status_code=422, detail="Enter a complete HTTP or HTTPS URL without credentials or a fragment.")
    allowed = {host.strip().lower() for host in os.getenv("URL_MONITOR_ALLOWED_HOSTS", "").split(",") if host.strip()}
    if allowed and parsed.hostname.lower() not in allowed:
        raise HTTPException(status_code=422, detail="This hostname is not in URL_MONITOR_ALLOWED_HOSTS.")
    if not allowed:
        try:
            addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))}
            if any(ipaddress.ip_address(address).is_private or ipaddress.ip_address(address).is_loopback or ipaddress.ip_address(address).is_link_local for address in addresses):
                raise HTTPException(status_code=422, detail="Private hosts must be explicitly listed in URL_MONITOR_ALLOWED_HOSTS.")
        except socket.gaierror:
            pass
    values["name"] = values["name"].strip()
    values["url"] = values["url"].strip().rstrip("/")
    values["health_path"] = values["health_path"].strip()
    if values["health_path"] and not values["health_path"].startswith("/"):
        values["health_path"] = "/" + values["health_path"]
    return values


def _monitor_target(monitor: dict[str, Any]) -> str:
    """Revalidate every request to prevent DNS changes from reaching internal addresses."""
    base = str(monitor["url"]).rstrip("/")
    target = base + str(monitor.get("health_path", ""))
    parsed = urlparse(target)
    allowed = {host.strip().lower() for host in os.getenv("URL_MONITOR_ALLOWED_HOSTS", "").split(",") if host.strip()}
    if not parsed.hostname or parsed.scheme not in {"http", "https"}:
        raise ValueError("Invalid monitor URL")
    if allowed and parsed.hostname.lower() not in allowed:
        raise ValueError("Host is not allowlisted")
    if not allowed:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))}
        if any(ipaddress.ip_address(address).is_private or ipaddress.ip_address(address).is_loopback or ipaddress.ip_address(address).is_link_local for address in addresses):
            raise ValueError("Private host is not allowlisted")
    return target


async def _check_url_monitors(*, retain_history: bool = True) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient(follow_redirects=False, timeout=5.0) as http:
        for monitor in _read_url_monitors():
            result = {**monitor, "status": "disabled" if not monitor.get("enabled", True) else "down", "latency_ms": None, "checked_at": datetime.now(timezone.utc).isoformat(), "status_code": None, "error": None}
            if monitor.get("enabled", True):
                started = time.perf_counter()
                try:
                    response = await http.get(_monitor_target(monitor))
                    result["latency_ms"] = round((time.perf_counter() - started) * 1000)
                    result["status_code"] = response.status_code
                    result["status"] = "operational" if response.status_code == monitor.get("expected_status", 200) else "degraded"
                except (httpx.RequestError, ValueError, socket.gaierror) as error:
                    result["latency_ms"] = round((time.perf_counter() - started) * 1000)
                    result["error"] = error.__class__.__name__
            results.append(result)
    if retain_history:
        _retain_url_monitor_history(results)
    return results


async def _url_monitor_poll_loop() -> None:
    """Keep URL monitoring independent of an open browser session."""
    while True:
        try:
            await _check_url_monitors()
        except Exception:
            # Individual endpoint failures are already represented in check results.
            # The loop must stay alive even if monitor configuration changes mid-check.
            pass
        await asyncio.sleep(60)


def _correlate_operations(snapshot: dict[str, Any], monitors: list[dict[str, Any]], deployment_changes: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Rank explainable incident hypotheses from URL, workload, pod, and log signals."""
    import re
    deployments = snapshot.get("deployments", [])
    deployment_changes = deployment_changes or []
    incidents: list[dict[str, Any]] = []

    def tokens(value: str) -> set[str]:
        ignored = {"http", "https", "health", "service", "local"}
        return {part for part in re.split(r"[^a-z0-9]+", value.casefold()) if len(part) > 2 and part not in ignored}

    for monitor in monitors:
        if monitor.get("status") not in {"down", "degraded"}:
            continue
        terms = tokens(f'{monitor.get("name", "")} {urlparse(str(monitor.get("url", ""))).hostname or ""}')
        matches = [item for item in deployments if tokens(str(item.get("name", ""))) & terms]
        evidence = [f'{monitor.get("environment", "unknown").upper()} URL is {monitor.get("status")}: HTTP {monitor.get("status_code") or "no response"} in {monitor.get("latency_ms") or 0} ms.']
        score = 70 if monitor.get("status") == "down" else 50
        cause = "The endpoint is not returning its expected response. No matching workload was identified yet."
        pod_name = deployment_name = None
        if matches:
            deployment = matches[0]
            deployment_name = deployment.get("name")
            recent_change = next((change for change in deployment_changes if change.get("workload", change.get("pod")) == deployment_name and change.get("change_type") == "image"), None)
            if recent_change:
                score += 15
                age_minutes = max(0, round((time.time() - float(recent_change.get("timestamp", 0))) / 60))
                evidence.append(f'Release changed {age_minutes} minute(s) ago: {recent_change.get("previous_image") or "unknown"} → {recent_change.get("current_image") or "unknown"}.')
                cause = "The availability failure follows a recent release image change."
            if deployment.get("status") not in {"Ready", "Running", "Healthy"} or deployment.get("available", 0) < deployment.get("desired", 0):
                score += 18
                evidence.append(f'{deployment_name} readiness is {deployment.get("available", 0)}/{deployment.get("desired", 0)} ({deployment.get("status", "Unknown")}).')
                cause = "The URL failure aligns with reduced deployment readiness."
            resources = sorted(deployment.get("resources", []), key=lambda item: (item.get("pod", {}).get("risk") == "critical", item.get("pod", {}).get("restarts", 0)), reverse=True)
            if resources:
                pod = resources[0].get("pod", {})
                analysis = resources[0].get("analysis", {})
                pod_name = pod.get("name")
                if pod.get("status") not in {"Running", "Succeeded"} or pod.get("restarts", 0):
                    score += 12
                    evidence.append(f'{pod_name} is {pod.get("status", "Unknown")} with {pod.get("restarts", 0)} restart(s).')
                    cause = "The URL failure aligns with an unhealthy or restarting application pod."
                counts = analysis.get("counts", {})
                if counts.get("errors", 0) or counts.get("oom_events", 0):
                    score += 10
                    evidence.append(f'Logs for {pod_name} contain {counts.get("errors", 0)} error(s) and {counts.get("oom_events", 0)} OOM event(s).')
                    cause = "Application log failures coincide with the availability failure."
        incidents.append({"id": f'url:{monitor.get("id", monitor.get("name", "endpoint"))}', "severity": "critical" if score >= 70 else "warning", "score": min(score, 100), "confidence": min(95, 45 + len(evidence) * 15), "title": f'{monitor.get("name", "Application")} is {monitor.get("status")}', "summary": f'{monitor.get("environment", "unknown").upper()} availability is affected.', "probable_cause": cause, "evidence": evidence[:4], "recommendation": "Open the related pod and review recent logs; if the problem started after a release, compare or roll back the deployed image." if pod_name else "Confirm routing, DNS, certificate, and upstream availability, then map the URL name to its workload for deeper correlation.", "pod": pod_name, "deployment": deployment_name, "environment": monitor.get("environment")})

    matched_pods = {item.get("pod") for item in incidents}
    completed_tasks = set(snapshot.get("completed_tasks", []))
    for pod in snapshot.get("pods", []):
        analysis = snapshot.get("analysis", {}).get(pod.get("name"), {})
        counts = analysis.get("counts", {})
        if any(f'-{task}-' in str(pod.get("name", "")) for task in completed_tasks):
            continue
        if pod.get("name") in matched_pods or (pod.get("risk") == "healthy" and not counts.get("errors") and not counts.get("oom_events")):
            continue
        score = (65 if pod.get("risk") == "critical" else 45) + min(20, int(pod.get("restarts", 0)) * 4) + (15 if counts.get("oom_events") else 0)
        evidence = [f'{pod.get("name")} is {pod.get("status", "Unknown")} with risk {pod.get("risk", "unknown")}.']
        if pod.get("restarts", 0): evidence.append(f'{pod.get("restarts")} restart(s) detected.')
        if counts.get("errors") or counts.get("oom_events"): evidence.append(f'Logs contain {counts.get("errors", 0)} error(s) and {counts.get("oom_events", 0)} OOM event(s).')
        incidents.append({"id": f'pod:{pod.get("name")}', "severity": "critical" if score >= 70 else "warning", "score": min(score, 100), "confidence": min(90, 45 + len(evidence) * 15), "title": f'{pod.get("name")} needs attention', "summary": "A workload signal was detected before or without an external URL failure.", "probable_cause": analysis.get("findings", ["Container health or log signals require investigation."])[0], "evidence": evidence, "recommendation": "Open the pod investigation, review recent logs and memory pressure, then compare the current image with the last known healthy deployment.", "pod": pod.get("name"), "deployment": None, "environment": None})

    matched_deployments = {item.get("deployment") for item in incidents}
    for deployment in deployments:
        name = deployment.get("name")
        healthy = deployment.get("status") in {"Ready", "Running", "Healthy", "Completed"} and deployment.get("available", 0) >= deployment.get("desired", 0)
        if name in matched_deployments or healthy:
            continue
        desired, available = deployment.get("desired", 0), deployment.get("available", 0)
        evidence = [f'{name} readiness is {available}/{desired} ({deployment.get("status", "Unknown")}).', f'Current deployed image: {deployment.get("image", "Not available")}.']
        restarts = deployment.get("summary", {}).get("restarts", 0)
        if restarts:
            evidence.append(f'{restarts} restart(s) detected across owned pods.')
        score = min(95, 55 + (20 if desired and available == 0 else 8) + min(12, restarts * 3))
        incidents.append({"id": f'deployment:{name}', "severity": "critical" if score >= 70 else "warning", "score": score, "confidence": min(90, 50 + len(evidence) * 12), "title": f'{name} deployment is not fully ready', "summary": "Deployment health is degraded even if an external URL has not failed yet.", "probable_cause": "One or more desired replicas are unavailable or unhealthy.", "evidence": evidence, "recommendation": "Inspect the unavailable pod, review its events and logs, and compare the deployed image with the last healthy release.", "pod": None, "deployment": name, "environment": None})

    incidents.sort(key=lambda item: item["score"], reverse=True)
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "engine": {"name": "L1 deterministic investigation engine", "ai_required": False, "method": "Rule and evidence correlation"}, "summary": {"total": len(incidents), "critical": sum(item["severity"] == "critical" for item in incidents), "warning": sum(item["severity"] == "warning" for item in incidents), "signals_correlated": len(monitors) + len(snapshot.get("pods", [])) + len(snapshot.get("analysis", {})) + len(deployments)}, "release_timeline": deployment_changes[:12], "incidents": incidents[:12]}


def _deployment_comparisons(snapshot: dict[str, Any], history: dict[str, Any]) -> list[dict[str, Any]]:
    now = time.time()
    comparisons = []
    changes = [event for event in history.get("deployment_changes", []) if event.get("change_type") in {"image", "observed"}]
    current_by_name = {item.get("name"): item for item in snapshot.get("deployments", [])}

    def workload_points(samples: list[dict[str, Any]], name: str, start: float, end: float) -> list[dict[str, Any]]:
        return [workload for sample in samples if start <= float(sample.get("timestamp", 0)) <= end for workload in sample.get("workloads", []) if workload.get("name") == name]

    def aggregate(points: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not points:
            return None
        return {"samples": len(points), "cpu_percent": round(sum(float(item.get("cpu", 0)) for item in points) / len(points), 1), "memory_percent": round(sum(float(item.get("memory", 0)) for item in points) / len(points), 1), "errors": max(int(item.get("errors", 0)) for item in points), "restarts": max(int(item.get("restarts", 0)) for item in points), "ready_percent": round(100 * sum(float(item.get("available", 0)) / max(float(item.get("desired", 0)), 1) for item in points) / len(points), 1)}

    for change in changes[:10]:
        changed_at = float(change.get("timestamp", 0))
        name = str(change.get("workload") or change.get("pod") or "workload")
        before = aggregate(workload_points(history.get("samples", []), name, changed_at - 900, changed_at - 0.001))
        after = aggregate(workload_points(history.get("samples", []), name, changed_at, min(now, changed_at + 900)))
        current = current_by_name.get(name, {})
        if after is None and current:
            summary = current.get("summary", {})
            after = {"samples": 1, "cpu_percent": summary.get("cpu_percent", 0), "memory_percent": round(100 * summary.get("memory_mib", 0) / max(summary.get("memory_limit_mib", 0), 1), 1), "errors": sum(resource.get("analysis", {}).get("counts", {}).get("errors", 0) for resource in current.get("resources", [])), "restarts": summary.get("restarts", 0), "ready_percent": round(100 * current.get("available", 0) / max(current.get("desired", 0), 1), 1)}
        deltas = {key: round(float(after.get(key, 0)) - float(before.get(key, 0)), 1) for key in ("cpu_percent", "memory_percent", "errors", "restarts", "ready_percent")} if before and after else None
        regressed = bool(deltas and (deltas["errors"] > 0 or deltas["restarts"] > 0 or deltas["ready_percent"] < 0 or deltas["memory_percent"] >= 15))
        comparisons.append({"id": change.get("id"), "workload": name, "changed_at": changed_at, "previous_image": change.get("previous_image", ""), "current_image": change.get("current_image", current.get("image", "")), "change_type": change.get("change_type"), "before": before, "after": after, "deltas": deltas, "status": "regressed" if regressed else "stable" if before and after else "collecting", "window_minutes": 15})
    return comparisons


def _operational_change_timeline(history: dict[str, Any]) -> list[dict[str, Any]]:
    """Return a small, human-readable change feed from retained runtime evidence."""
    relevant_kinds = {"deployment", "runtime", "restart", "health", "alert", "log"}
    entries: list[dict[str, Any]] = []
    for event in history.get("events", []):
        if event.get("kind") not in relevant_kinds:
            continue
        entries.append({
            "id": event.get("id", ""),
            "timestamp": float(event.get("timestamp", 0)),
            "kind": event.get("kind", "change"),
            "severity": event.get("severity", "healthy"),
            "title": str(event.get("title", "Operational change")),
            "detail": str(event.get("detail", "")),
            "pod": event.get("pod"),
        })
    return entries[:12]


def _recovery_timeline(history: dict[str, Any]) -> list[dict[str, Any]]:
    """Identify observed healthy transitions that follow an operational warning."""
    active_issues: dict[str, dict[str, Any]] = {}
    recoveries: list[dict[str, Any]] = []
    events = sorted(history.get("events", []), key=lambda item: float(item.get("timestamp", 0)))
    for event in events:
        pod = str(event.get("pod") or "")
        if not pod:
            continue
        severity = str(event.get("severity", "healthy"))
        if severity in {"warning", "critical"}:
            active_issues[pod] = event
            continue
        if severity != "healthy" or event.get("kind") not in {"runtime", "health", "deployment"}:
            continue
        issue = active_issues.pop(pod, None)
        if not issue:
            continue
        recovered_at = float(event.get("timestamp", 0))
        started_at = float(issue.get("timestamp", recovered_at))
        recoveries.append({"pod": pod, "timestamp": recovered_at, "duration_seconds": max(0, round(recovered_at - started_at)), "issue": str(issue.get("title", "Operational warning")), "recovery": str(event.get("title", "Healthy state observed"))})
    return list(reversed(recoveries))[:6]


def _default_prometheus_settings() -> dict:
    return {"enabled": os.getenv("PROMETHEUS_ENABLED", "true").lower() == "true", "base_url": os.getenv("PROMETHEUS_URL", "http://prometheus:9090").rstrip("/")}


def _read_prometheus_settings() -> dict:
    settings = _default_prometheus_settings()
    try:
        saved = json.loads(_prometheus_settings_file().read_text())
        if isinstance(saved, dict):
            settings.update({key: saved[key] for key in settings if key in saved})
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    settings["base_url"] = str(settings["base_url"]).rstrip("/")
    return settings


def _validate_prometheus_settings(settings: dict) -> dict:
    base_url = str(settings["base_url"]).rstrip("/")
    if settings["enabled"]:
        parsed = urlparse(base_url)
        allowed_hosts = {item.strip().lower() for item in os.getenv("PROMETHEUS_ALLOWED_HOSTS", "").split(",") if item.strip()}
        allow_http = os.getenv("PROMETHEUS_ALLOW_HTTP", "false").lower() == "true"
        local_compose_prometheus = os.getenv("MONITORING_TARGET", "docker").lower() == "docker" and parsed.hostname == "prometheus" and parsed.scheme == "http"
        if (not local_compose_prometheus and parsed.scheme not in ({"https", "http"} if allow_http else {"https"})) or not parsed.hostname or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise HTTPException(status_code=422, detail="Use an approved HTTPS Prometheus URL without a path.")
        if not local_compose_prometheus and (not allowed_hosts or parsed.hostname.lower() not in allowed_hosts):
            raise HTTPException(status_code=422, detail="This Prometheus host is not approved. Ask an administrator to add it to PROMETHEUS_ALLOWED_HOSTS.")
    settings["base_url"] = base_url
    return settings


def _default_splunk_settings() -> dict:
    return {
        "enabled": os.getenv("SPLUNK_ENABLED", "false").lower() == "true",
        "base_url": os.getenv("SPLUNK_BASE_URL", "").rstrip("/"),
        "index": os.getenv("SPLUNK_INDEX", "main"),
        "pod_field": os.getenv("SPLUNK_POD_FIELD", "kubernetes.pod_name"),
        "scope_field": os.getenv("SPLUNK_SCOPE_FIELD", "kubernetes.namespace"),
        "scope_value": os.getenv("SPLUNK_SCOPE_VALUE", ""),
        "lookback_minutes": int(os.getenv("SPLUNK_LOOKBACK_MINUTES", "15")),
    }


def _read_splunk_settings() -> dict:
    settings = _default_splunk_settings()
    try:
        saved = json.loads(_splunk_settings_file().read_text())
        if isinstance(saved, dict):
            settings.update({key: saved[key] for key in settings if key in saved})
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    settings["base_url"] = str(settings["base_url"]).rstrip("/")
    return settings


def _validate_splunk_settings(runtime: dict) -> dict:
    base_url = str(runtime["base_url"]).rstrip("/")
    if runtime["enabled"]:
        parsed = urlparse(base_url)
        allowed_hosts = {item.strip().lower() for item in os.getenv("SPLUNK_ALLOWED_HOSTS", "").split(",") if item.strip()}
        allow_http = os.getenv("SPLUNK_ALLOW_HTTP", "false").lower() == "true"
        if parsed.scheme not in ({"https", "http"} if allow_http else {"https"}) or not parsed.hostname or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise HTTPException(status_code=422, detail="Use an approved HTTPS Splunk base URL without a path.")
        if not allowed_hosts or parsed.hostname.lower() not in allowed_hosts:
            raise HTTPException(status_code=422, detail="This Splunk host is not approved. Ask an administrator to add its hostname to SPLUNK_ALLOWED_HOSTS.")
        if not os.getenv("SPLUNK_API_TOKEN", "").strip():
            raise HTTPException(status_code=422, detail="SPLUNK_API_TOKEN is not configured. Add it as an environment variable or Kubernetes Secret first.")
    import re

    if not re.fullmatch(r"[A-Za-z0-9_.-]+", str(runtime["index"])):
        raise HTTPException(status_code=422, detail="Splunk index may contain only letters, numbers, dots, underscores, and hyphens.")
    if not re.fullmatch(r"[A-Za-z0-9_.]+", str(runtime["pod_field"])):
        raise HTTPException(status_code=422, detail="Splunk pod field may contain only letters, numbers, dots, and underscores.")
    if runtime["scope_value"] and not re.fullmatch(r"[A-Za-z0-9_.:-]+", str(runtime["scope_field"])):
        raise HTTPException(status_code=422, detail="Splunk scope field may contain only letters, numbers, dots, underscores, colons, and hyphens.")
    runtime["base_url"] = base_url
    runtime["index"] = str(runtime["index"]).strip()
    runtime["pod_field"] = str(runtime["pod_field"]).strip()
    runtime["scope_field"] = str(runtime["scope_field"]).strip()
    runtime["scope_value"] = str(runtime["scope_value"]).strip()
    return runtime


def _default_ollama_settings() -> dict:
    return {
        "enabled": os.getenv("OLLAMA_ENABLED", "false").lower() == "true",
        "base_url": os.getenv("OLLAMA_BASE_URL", "http://ollama:11434").rstrip("/"),
        "model": os.getenv("OLLAMA_MODEL", "llama3.2:3b"),
    }


def _read_ollama_settings() -> dict:
    settings = _default_ollama_settings()
    try:
        saved = json.loads(_ollama_settings_file().read_text())
        if isinstance(saved, dict):
            settings.update({key: saved[key] for key in settings if key in saved})
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    settings["base_url"] = str(settings["base_url"]).rstrip("/")
    return settings


def _validate_local_ollama_url(value: str) -> str:
    parsed = urlparse(value)
    allowed_hosts = {"ollama", "localhost", "127.0.0.1", "host.docker.internal"}
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in allowed_hosts or not parsed.port:
        raise HTTPException(status_code=422, detail="Use an Ollama URL on ollama, localhost, 127.0.0.1, or host.docker.internal, including its port.")
    return value.rstrip("/")


def _ground_answer_with_ollama(runtime: dict[str, Any], result: dict[str, Any], question: str) -> tuple[str | None, str | None]:
    """Ask the local runtime to explain an already-grounded answer, never to retrieve data."""
    import requests

    base_url = _validate_local_ollama_url(str(runtime["base_url"]))
    prompt = (
        "You are L1ControlScope, an internal operations assistant. Rewrite the supplied verified "
        "answer in concise plain language. Use only the supplied answer. Do not add facts, pod "
        "names, causes, remediation, commands, or certainty that are not already present. "
        "Keep it under 160 words and return plain text only.\n\n"
        f"User question: {question}\n\nVerified PulseOps answer:\n{result['answer']}"
    )
    try:
        response = requests.post(
            f"{base_url}/api/chat",
            json={
                "model": runtime["model"],
                "stream": False,
                "messages": [
                    {"role": "system", "content": "Only summarize the verified PulseOps answer. Never invent operational facts."},
                    {"role": "user", "content": prompt},
                ],
                "options": {"temperature": 0, "num_predict": 240},
            },
            timeout=20,
        )
        response.raise_for_status()
        content = str(response.json().get("message", {}).get("content", "")).strip()
        if not content:
            return None, "Ollama returned an empty response."
        return content, None
    except requests.RequestException as error:
        return None, f"Local Ollama is unavailable; PulseOps used its Python intelligence instead. ({error.__class__.__name__})"


def _ask_operations_plan(question: str, snapshot: dict[str, Any], requested_minutes: int) -> dict[str, Any]:
    import re
    normalized = question.casefold()
    explicit_sources = [source for source, words in {"pod logs": ("pod log", "logs", "log "), "deployments": ("deployment", "release", "image", "rollout"), "splunk": ("splunk",), "history": ("history", "incident", "alert", "restart")}.items() if any(word in normalized for word in words)]
    sources = explicit_sources or ["pod logs", "deployments", "history"]
    if any(phrase in normalized for phrase in ("all sources", "every source", "everywhere")) and "splunk" not in sources:
        sources.append("splunk")
    levels = [level for level in ("critical", "error", "warning") if level in normalized]
    if not levels and any(word in normalized for word in ("issue", "issues", "problem", "problems", "failed", "failure")):
        levels = ["critical", "error", "warning"]
    ignored = {"find", "search", "show", "check", "look", "for", "from", "within", "during", "about", "any", "all", "every", "everywhere", "source", "sources", "the", "a", "an", "in", "on", "last", "hour", "hours", "day", "days", "today", "yesterday", "pod", "pods", "application", "applications", "app", "logs", "log", "deployment", "deployments", "splunk", "history", "error", "errors", "warning", "warnings", "critical", "issue", "issues", "problem", "problems"}
    quoted = re.findall(r'["“]([^"”]{2,120})["”]', question)
    terms = quoted or [term for term in re.findall(r"[a-zA-Z0-9_.:/=-]{2,80}", normalized) if term not in ignored and not term.isdigit()]
    pod_names = [str(pod.get("name", "")) for pod in snapshot.get("pods", [])]
    matched_pods = sorted({name for name in pod_names if any(term in name.casefold() for term in terms)})
    return {"sources": sources, "time_range_minutes": requested_minutes, "levels": levels, "terms": terms[:8], "matched_pods": matched_pods}


def _search_splunk_for_plan(plan: dict[str, Any]) -> tuple[list[dict[str, str]], str | None]:
    import requests
    settings = _read_splunk_settings()
    if not settings.get("enabled") or not os.getenv("SPLUNK_API_TOKEN", "").strip():
        return [], "Splunk is not configured or its read-only API token is unavailable."
    try:
        field = settings["pod_field"]
        scope = f'{settings["scope_field"]}="{str(settings["scope_value"]).replace(chr(34), "")}" ' if settings.get("scope_value") else ""
        pod_clause = " OR ".join(f'{field}="*{name.replace(chr(34), "")}*"' for name in plan.get("matched_pods", [])[:10])
        term_clause = " ".join(f'"{str(term).replace(chr(34), "")}"' for term in plan.get("terms", [])[:5])
        filters = f'({pod_clause}) ' if pod_clause else ""
        search = f'search index="{settings["index"]}" earliest=-{plan["time_range_minutes"]}m {scope}{filters}{term_clause} | head 100'
        response = requests.post(f'{settings["base_url"]}/services/search/jobs', headers={"Authorization": f'Bearer {os.environ["SPLUNK_API_TOKEN"]}'}, data={"search": search, "output_mode": "json", "exec_mode": "oneshot", "count": 100}, timeout=15, verify=os.getenv("SPLUNK_VERIFY_TLS", "true").lower() == "true")
        response.raise_for_status()
        records = []
        for item in response.json().get("results", [])[:100]:
            raw = str(item.get("_raw", item.get("message", "")))
            masked = structure_logs([raw])[0]
            records.append({"pod": str(item.get(field, "splunk")), "text": masked["message"], "level": masked["level"], "timestamp": str(item.get("_time", ""))})
        return records, None
    except (requests.RequestException, ValueError, KeyError, TypeError) as error:
        return [], f"Splunk search could not complete ({error.__class__.__name__})."


def _execute_ask_operations(plan: dict[str, Any], snapshot: dict[str, Any], history: dict[str, Any]) -> dict[str, Any]:
    terms = [str(term).casefold() for term in plan.get("terms", [])]
    matched = set(plan.get("matched_pods", []))
    results: list[dict[str, str]] = []
    source_status: dict[str, str] = {}
    if "pod logs" in plan["sources"]:
        for pod, records in snapshot.get("structured_logs", {}).items():
            if matched and pod not in matched: continue
            for record in records:
                haystack = f'{record.get("message", "")} {record.get("raw", "")}'.casefold()
                if terms and not any(term in haystack or term in pod.casefold() for term in terms): continue
                if plan["levels"] and record.get("level", "").replace("warn", "warning") not in plan["levels"]: continue
                results.append({"source": "Pod logs", "pod": pod, "text": str(record.get("message", "")), "timestamp": str(record.get("timestamp") or "")})
        source_status["Pod logs"] = f"{len([item for item in results if item['source'] == 'Pod logs'])} matches"
    if "deployments" in plan["sources"]:
        for deployment in snapshot.get("deployments", []):
            haystack = f'{deployment.get("name", "")} {deployment.get("image", "")} {deployment.get("status", "")}'.casefold()
            if terms and not any(term in haystack for term in terms): continue
            results.append({"source": "Deployments", "pod": str(deployment.get("name", "workload")), "text": f'{deployment.get("status", "Unknown")} · image {deployment.get("image", "Not available")} · ready {deployment.get("available", 0)}/{deployment.get("desired", 0)}', "timestamp": "current"})
        source_status["Deployments"] = f"{len([item for item in results if item['source'] == 'Deployments'])} matches"
    if "history" in plan["sources"]:
        for event in history.get("events", []):
            name = str(event.get("pod") or event.get("workload") or "platform")
            haystack = f'{name} {event.get("title", "")} {event.get("detail", "")}'.casefold()
            if terms and not any(term in haystack for term in terms): continue
            results.append({"source": "History", "pod": name, "text": f'{event.get("title", "Signal")}: {event.get("detail", "")}', "timestamp": str(event.get("timestamp", ""))})
        source_status["History"] = f"{len([item for item in results if item['source'] == 'History'])} matches"
    if "splunk" in plan["sources"]:
        splunk_results, error = _search_splunk_for_plan(plan)
        results.extend({"source": "Splunk", **item} for item in splunk_results)
        source_status["Splunk"] = error or f"{len(splunk_results)} matches"
    scope = {**plan, "source_status": source_status}
    if results:
        grouped = {}
        for item in results: grouped[item["source"]] = grouped.get(item["source"], 0) + 1
        answer = f"L1ControlScope searched the requested operational sources and found {len(results)} result(s): " + ", ".join(f"{count} from {source}" for source, count in grouped.items()) + ".\n" + "\n".join(f'• [{item["source"]}] {item["pod"]} — {item["text"][:260]}' for item in results[:8])
    else:
        answer = "L1ControlScope searched the requested operational sources and found no matching evidence. " + "; ".join(f"{source}: {status}" for source, status in source_status.items())
    evidence = [{"kind": item["source"].casefold(), "pod": item["pod"], "text": item["text"][:260]} for item in results[:3]]
    return {"answer": answer, "mode": "app-first-query-planner", "sources": list(source_status), "evidence": evidence, "scope": scope}


def _session_response(user: dict[str, str], token: str) -> JSONResponse:
    response = JSONResponse({"user": user})
    response.set_cookie(
        "pulseops_session",
        token,
        max_age=8 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true",
    )
    return response


@app.get("/api/auth/me")
def auth_me(request: Request) -> dict:
    oidc_available = _oidc_ready()
    return {"user": auth.current_user(request.cookies.get("pulseops_session")), "mode": os.getenv("AUTH_MODE", "local"), "oidc_available": oidc_available, "break_glass_enabled": auth.break_glass_enabled(), "break_glass_setup_available": auth.break_glass_setup_available(), "break_glass_username": os.getenv("AUTH_BREAK_GLASS_USERNAME", "admin")}


@app.post("/api/auth/register")
def auth_register(register: LocalRegisterRequest) -> JSONResponse:
    try:
        user = auth.register(register.email, register.password, register.name)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return _session_response(user, auth.start_session(user))


@app.post("/api/auth/login")
def auth_login(login: LocalLoginRequest) -> JSONResponse:
    try:
        user = auth.authenticate(login.email, login.password)
    except AccountLockedError as error:
        raise HTTPException(status_code=423, detail=str(error)) from error
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    return _session_response(user, auth.start_session(user))


@app.get("/api/auth/oidc/login")
async def auth_oidc_login(request: Request):
    """Start authorization-code sign-in only when non-secret OIDC settings and Secret are present."""
    client = _oidc_client()
    return await client.authorize_redirect(request, os.environ["OIDC_REDIRECT_URL"])


@app.get("/api/auth/oidc/callback")
async def auth_oidc_callback(request: Request):
    client = _oidc_client()
    try:
        token = await client.authorize_access_token(request)
        claims = token.get("userinfo") or await client.userinfo(token=token)
        email = str(claims.get("email") or claims.get("preferred_username") or "").strip().lower()
        name = str(claims.get("name") or claims.get("given_name") or email)
        if not email:
            raise ValueError("The identity provider did not return an email address.")
        user = auth.upsert_oidc_user(email, name)
    except Exception as error:
        raise HTTPException(status_code=401, detail=f"OIDC sign-in was not completed: {error}") from error
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie("pulseops_session", auth.start_session(user), max_age=8 * 60 * 60, httponly=True, samesite="lax", secure=os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true")
    return response


@app.post("/api/auth/bootstrap-admin")
def auth_bootstrap_admin(login: LocalLoginRequest) -> JSONResponse:
    try:
        user = auth.bootstrap_break_glass_admin(login.password)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return _session_response(user, auth.start_session(user))


@app.post("/api/auth/logout")
def auth_logout(request: Request) -> JSONResponse:
    auth.end_session(request.cookies.get("pulseops_session"))
    response = JSONResponse({"signed_out": True})
    response.delete_cookie("pulseops_session")
    return response


@app.get("/api/admin/users")
def admin_users(request: Request) -> dict:
    require_administrator(request)
    return {"users": auth.list_users()}


@app.get("/api/admin/users/{email}")
def admin_user_profile(email: str, request: Request) -> dict:
    require_administrator(request)
    user = auth.get_user(email)
    if not user:
        raise HTTPException(status_code=404, detail="User account was not found.")
    return {"user": user}


@app.put("/api/admin/users/{email}/status")
def admin_user_status(email: str, update: UserStatusUpdate, request: Request) -> dict:
    actor = require_administrator(request)
    try:
        user = auth.set_user_enabled(email, update.enabled, actor["email"])
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    _audit("user.enabled" if update.enabled else "user.disabled", actor, user["email"], {"enabled": update.enabled})
    return {"user": user}


@app.delete("/api/admin/users/{email}")
def admin_delete_user(email: str, request: Request) -> dict:
    actor = require_administrator(request)
    try:
        auth.delete_user(email, actor["email"])
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    _audit("user.deleted", actor, email.strip().lower())
    return {"deleted": True}


@app.put("/api/admin/users/{email}/role")
def admin_user_role(email: str, update: UserRoleUpdate, request: Request) -> dict:
    actor = require_administrator(request)
    try:
        user = auth.set_user_role(email, update.role, actor["email"])
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    _audit("user.role_changed", actor, user["email"], {"role": user["role"]})
    return {"user": user}


@app.put("/api/admin/users/{email}/unlock")
def admin_unlock_user(email: str, request: Request) -> dict:
    actor = require_administrator(request)
    try:
        user = auth.unlock_user(email, actor["email"])
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    _audit("user.unlocked", actor, user["email"])
    return {"user": user}


@app.get("/api/admin/audit-events")
def admin_audit_events(request: Request, limit: int = Query(default=50, ge=1, le=200)) -> dict:
    require_administrator(request)
    return {"events": list(reversed(_read_audit_events()))[:limit]}


@app.get("/health")
def health() -> dict:
    """Liveness endpoint: the web process is available.

    Collection can depend on an external Kubernetes, Docker, Splunk, or
    Prometheus endpoint. A collection failure must not restart the dashboard
    process in a loop, so readiness is reported separately at ``/ready``.
    """
    return {"status": "ok", "service": "pulseops-ai", "collector": collector.status()}


def _telemetry_readiness() -> tuple[bool, dict]:
    status = collector.status()
    maximum_age = max(15, int(os.getenv("TELEMETRY_STALE_AFTER_SECONDS", str(max(30, collector.interval_seconds * 4)))))
    last_collected = status.get("last_collected")
    age_seconds: int | None = None
    if last_collected:
        try:
            collected_at = datetime.fromisoformat(str(last_collected).replace("Z", "+00:00"))
            age_seconds = max(0, round((datetime.now(timezone.utc) - collected_at).total_seconds()))
        except ValueError:
            pass
    healthy = bool(status.get("running")) and not status.get("error") and age_seconds is not None and age_seconds <= maximum_age
    return healthy, {
        "status": "ready" if healthy else "degraded",
        "service": "pulseops-ai",
        "collector": {**status, "age_seconds": age_seconds, "stale_after_seconds": maximum_age},
    }


@app.get("/ready")
def ready() -> JSONResponse:
    """Readiness endpoint: only route traffic when live telemetry is current."""
    healthy, payload = _telemetry_readiness()
    return JSONResponse(status_code=200 if healthy else 503, content=payload)


@app.get("/metrics")
def metrics() -> Response:
    # Docker readings are refreshed by the dashboard request. Exporting the
    # latest values must remain fast so Prometheus never competes for Docker.
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/api/overview")
def overview(request: Request) -> dict:
    try:
        snapshot = snapshot_for_user(collector.snapshot(), request.state.user)
        snapshot["alert_acknowledgements"] = _read_alert_acknowledgements()
        snapshot["source_context"] = {
            "repository_url": os.getenv("SOURCE_REPOSITORY_URL", "").strip(),
            "commit_sha": os.getenv("SOURCE_COMMIT_SHA", "").strip(),
            "default_branch": os.getenv("SOURCE_DEFAULT_BRANCH", "main").strip() or "main",
            "source_path": os.getenv("SOURCE_PATH", "").strip().strip("/"),
        }
        return snapshot
    except ClusterConnectionError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/observability/history")
def observability_history(minutes: int = Query(default=60, ge=5, le=1440)) -> dict:
    try:
        return collector.observability_report(minutes)
    except ClusterConnectionError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/incident-workspaces")
def incident_workspaces() -> dict:
    return {"workspaces": list(reversed(_read_workspaces()))}


@app.get("/api/incident-workspaces/{workspace_id}")
def incident_workspace(workspace_id: str, request: Request) -> dict:
    require_developer_or_administrator(request)
    workspace = next((item for item in _read_workspaces() if item.get("id") == workspace_id), None)
    if not workspace:
        raise HTTPException(status_code=404, detail="Incident workspace not found")
    return {"workspace": workspace}


@app.post("/api/incident-workspaces")
def create_incident_workspace(create: IncidentWorkspaceCreate, request: Request) -> dict:
    require_developer_or_administrator(request)
    from uuid import uuid4
    from datetime import datetime, timezone

    workspaces = _read_workspaces()
    workspace = {"id": str(uuid4()), **create.model_dump(), "status": "open", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}
    workspaces.append(workspace)
    _write_workspaces(workspaces)
    return {"workspace": workspace}


@app.put("/api/incident-workspaces/{workspace_id}")
def update_incident_workspace(workspace_id: str, update: IncidentWorkspaceUpdate, request: Request) -> dict:
    require_developer_or_administrator(request)
    from datetime import datetime, timezone

    workspaces = _read_workspaces()
    for workspace in workspaces:
        if workspace.get("id") == workspace_id:
            workspace.update({**update.model_dump(), "updated_at": datetime.now(timezone.utc).isoformat()})
            _write_workspaces(workspaces)
            return {"workspace": workspace}
    raise HTTPException(status_code=404, detail="Incident workspace not found")


@app.get("/api/incident-evidence/{incident_id}")
def incident_evidence(incident_id: str, request: Request) -> dict:
    """Return a captured, masked pre-incident log window to authorised investigators."""
    require_developer_or_administrator(request)
    incident = collector.incident_evidence.get(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident evidence was not found or has expired.")
    return incident


@app.get("/api/pods/{pod_name}/forecast")
def pod_forecast(pod_name: str) -> dict:
    try:
        snapshot = collector.snapshot()
    except ClusterConnectionError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    for forecast in snapshot["forecasts"]:
        if forecast["pod"] == pod_name:
            return forecast
    raise HTTPException(status_code=404, detail="Pod not found")


@app.get("/api/pods/{pod_name}/logs")
def pod_logs(
    pod_name: str,
    request: Request,
    index: int | None = Query(default=None, ge=0),
    before: int = Query(default=5, ge=0, le=50),
    limit: int = Query(default=25, ge=1, le=200),
) -> dict:
    """Return normalized JSON logs, optionally with context before one event."""
    require_developer_or_administrator(request)
    try:
        snapshot = collector.snapshot()
    except ClusterConnectionError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    records = snapshot["structured_logs"].get(pod_name)
    if records is None:
        raise HTTPException(status_code=404, detail="Pod not found")
    if index is None:
        return {"pod": pod_name, "format": "json", "logs": records[-limit:]}
    if index >= len(records):
        raise HTTPException(status_code=404, detail="Log entry not found")

    start = max(0, index - before)
    return {
        "pod": pod_name,
        "format": "json",
        "selected": records[index],
        "context": records[start : index + 1],
    }


@app.get("/api/pods/{pod_name}/tail")
def pod_log_tail(pod_name: str, request: Request):
    """Follow one selected pod's masked logs as a read-only SSE stream."""
    require_developer_or_administrator(request)
    try:
        snapshot = collector.snapshot()
    except ClusterConnectionError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    pod = next((item for item in snapshot.get("pods", []) if item.get("name") == pod_name), None)
    if not pod:
        raise HTTPException(status_code=404, detail="Pod not found.")

    from app.observability import Pod
    live_pod = Pod(**{key: pod[key] for key in ("name", "namespace", "status", "restarts", "cpu_millicores", "cpu_limit_millicores", "memory_mib", "memory_limit_mib", "node", "container_id", "image", "created_at", "ports", "reason") if key in pod})

    def send(event: str, payload: dict[str, Any]) -> str:
        return f"event: {event}\ndata: {json.dumps(payload)}\n\n"

    def events():
        yield send("status", {"state": "connected", "pod": pod_name})
        try:
            for raw in client.stream_logs(live_pod):
                record = structure_logs([raw])[0]
                yield send("log", {"pod": pod_name, "record": record})
        except ClusterConnectionError as error:
            yield send("tail-error", {"message": str(error)})
        except Exception:
            yield send("tail-error", {"message": "The live log stream ended unexpectedly. Retry the connection."})
        yield send("complete", {"pod": pod_name})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/alert-rules")
def alert_rules() -> dict:
    return {"rules": alerts.rules()}


@app.put("/api/alert-rules/{rule_id}")
def update_alert_rule(rule_id: str, update: AlertRuleUpdate, request: Request) -> dict:
    actor = require_administrator(request)
    try:
        rule = alerts.update_rule(rule_id, update.model_dump())
        collector.collect_once()
        _audit("alert_rule.updated", actor, rule_id, {"enabled": rule.get("enabled"), "threshold": rule.get("threshold"), "sustain_minutes": rule.get("sustain_minutes", 0), "scope_type": rule.get("scope_type", "all"), "scope_value": rule.get("scope_value", "")})
        return {"rule": rule}
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Alert rule not found") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/alert-rules")
def create_alert_rule(create: AlertRuleCreate, request: Request) -> dict:
    actor = require_administrator(request)
    try:
        rule = alerts.create_rule(create.model_dump())
        collector.collect_once()
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    _audit("alert_rule.created", actor, rule["id"], {"name": rule["name"], "metric": rule["metric"], "threshold": rule["threshold"], "sustain_minutes": rule.get("sustain_minutes", 0), "severity": rule["severity"], "scope_type": rule.get("scope_type", "all"), "scope_value": rule.get("scope_value", "")})
    return {"rule": rule}


@app.post("/api/alert-rules/log-pattern")
def create_log_pattern_alert(create: LogPatternAlertCreate, request: Request) -> dict:
    actor = require_administrator(request)
    rule = alerts.create_pattern_rule(create.model_dump())
    collector.collect_once()
    _audit("alert_rule.created", actor, str(rule.get("id", "log-pattern")), {"name": rule.get("name"), "threshold": rule.get("threshold"), "severity": rule.get("severity")})
    return {"rule": rule}


@app.delete("/api/alert-rules/{rule_id}")
def delete_alert_rule(rule_id: str, request: Request) -> dict:
    actor = require_administrator(request)
    try:
        alerts.delete_rule(rule_id)
        collector.collect_once()
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Alert rule not found") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    _audit("alert_rule.deleted", actor, rule_id)
    return {"deleted": rule_id}


@app.get("/api/alert-history")
def alert_history() -> dict:
    return {"events": alerts.history()}


@app.get("/api/notification-settings")
def notification_settings(request: Request) -> dict:
    require_administrator(request)
    return {"settings": notifier.settings()}


@app.put("/api/notification-settings")
def update_notification_settings(update: NotificationSettingsUpdate, request: Request) -> dict:
    actor = require_administrator(request)
    settings = notifier.update(update.enabled)
    _audit("notification_settings.updated", actor, "teams", {"enabled": settings["enabled"], "webhook_configured": settings["webhook_configured"]})
    return {"settings": settings}


@app.post("/api/notification-settings/test")
def test_notification_settings(request: Request) -> dict:
    actor = require_administrator(request)
    try:
        settings = notifier.test()
    except (ValueError, requests.RequestException) as error:
        # The client receives a configuration error, never the secret URL.
        raise HTTPException(status_code=422, detail=str(error)) from error
    _audit("notification_settings.tested", actor, "teams")
    return {"settings": settings, "message": "Test notification sent to Microsoft Teams."}


@app.put("/api/alert-acknowledgements")
def acknowledge_alert(update: AlertAcknowledgementUpdate, request: Request) -> dict:
    actor = require_developer_or_administrator(request)
    from datetime import datetime, timezone

    records = _read_alert_acknowledgements()
    record = {"status": update.status, "acknowledged_by": actor["email"], "acknowledged_at": datetime.now(timezone.utc).isoformat(), "note": update.note.strip()}
    records[update.key] = record
    _write_alert_acknowledgements(records)
    _audit(f"alert.{update.status}", actor, update.key, {"note": update.note.strip()})
    return {"acknowledgement": record}


@app.post("/api/assistant")
def operations_assistant(question: AssistantQuestion, request: Request) -> dict:
    try:
        snapshot = snapshot_for_user(collector.snapshot(), request.state.user)
    except ClusterConnectionError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    import re
    range_match = re.search(r"(?:last\s+)?(\d{1,3})\s*(hour|hours|day|days)", question.question, re.IGNORECASE)
    requested_minutes = 1440
    if range_match:
        requested_minutes = int(range_match.group(1)) * (1440 if range_match.group(2).casefold().startswith("day") else 60)
    requested_minutes = max(5, min(requested_minutes, 1440))
    history = collector.observability_report(requested_minutes)
    oldest_sample = history.get("samples", [{}])[0].get("timestamp") if history.get("samples") else None
    observed_minutes = min(requested_minutes, round((time.time() - float(oldest_sample)) / 60)) if oldest_sample else 0
    history["coverage"] = {
        "requested_minutes": requested_minutes,
        "retention_minutes": 1440,
        "oldest_sample": oldest_sample,
        "observed_minutes": observed_minutes,
        "complete": observed_minutes >= requested_minutes * 0.95,
    }
    snapshot["query_history"] = history
    planner_intent = bool(re.search(r"\b(find|search|look\s+for|splunk)\b", question.question, re.IGNORECASE))
    if planner_intent:
        plan = _ask_operations_plan(question.question, snapshot, requested_minutes)
        result = _execute_ask_operations(plan, snapshot, history)
        result["generated_at"] = snapshot.get("generated_at")
    else:
        result = answer_operations_question(snapshot, question.question, question.current_pod)
    runtime = _read_ollama_settings()
    if not runtime["enabled"]:
        result["runtime"] = {"provider": "python", "configured": False}
        return result

    generated, notice = _ground_answer_with_ollama(runtime, result, question.question)
    if generated:
        result["answer"] = generated
        result["mode"] = "grounded-local-ollama"
        result["runtime"] = {"provider": "ollama", "model": runtime["model"], "configured": True}
    else:
        result["runtime"] = {"provider": "python-fallback", "model": runtime["model"], "configured": True, "notice": notice}
    return result


@app.get("/api/ai-runtime")
def get_ai_runtime(request: Request) -> dict:
    """Return non-secret local Ollama runtime settings."""
    require_administrator(request)
    runtime = _read_ollama_settings()
    return {"runtime": runtime, "integration_active": runtime["enabled"]}


@app.put("/api/ai-runtime")
def update_ai_runtime(update: OllamaSettingsUpdate, request: Request) -> dict:
    actor = require_administrator(request)
    runtime = update.model_dump()
    runtime["base_url"] = _validate_local_ollama_url(runtime["base_url"])
    runtime["model"] = runtime["model"].strip()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _ollama_settings_file().write_text(json.dumps(runtime, indent=2) + "\n")
    _audit("settings.ollama_updated", actor, "ollama", {"enabled": runtime["enabled"], "base_url": runtime["base_url"], "model": runtime["model"]})
    return {"runtime": runtime, "integration_active": runtime["enabled"]}


@app.post("/api/ai-runtime/test")
def test_ai_runtime(request: Request, candidate: OllamaSettingsUpdate | None = None) -> dict:
    """Check the approved local Ollama endpoint without sending telemetry or prompts."""
    require_administrator(request)
    import requests

    runtime = candidate.model_dump() if candidate else _read_ollama_settings()
    base_url = _validate_local_ollama_url(runtime["base_url"])
    runtime["model"] = runtime["model"].strip()
    try:
        response = requests.get(f"{base_url}/api/tags", timeout=4)
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as error:
        return {"connected": False, "message": f"Ollama is not reachable at {base_url}. Start the optional Ollama service, then test again.", "detail": str(error)}
    model_names = [item.get("name") for item in payload.get("models", []) if item.get("name")]
    selected_available = runtime["model"] in model_names
    return {
        "connected": True,
        "message": f"Ollama is reachable. {len(model_names)} local model(s) found.",
        "models": model_names,
        "selected_model_available": selected_available,
        "selected_model": runtime["model"],
    }


@app.get("/api/splunk-settings")
def get_splunk_settings(request: Request) -> dict:
    require_administrator(request)
    """Return Splunk fallback configuration without exposing its API token."""
    settings = _read_splunk_settings()
    return {"settings": settings, "token_configured": bool(os.getenv("SPLUNK_API_TOKEN", "").strip())}


@app.put("/api/splunk-settings")
def update_splunk_settings(update: SplunkSettingsUpdate, request: Request) -> dict:
    actor = require_administrator(request)
    settings = _validate_splunk_settings(update.model_dump())
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _splunk_settings_file().write_text(json.dumps(settings, indent=2) + "\n")
    _audit("settings.splunk_updated", actor, "splunk", {"enabled": settings["enabled"], "base_url": settings["base_url"], "index": settings["index"], "scope_value": settings["scope_value"]})
    return {"settings": settings, "token_configured": bool(os.getenv("SPLUNK_API_TOKEN", "").strip())}


@app.post("/api/splunk-settings/test")
def test_splunk_settings(request: Request, candidate: SplunkSettingsUpdate | None = None) -> dict:
    """Check the approved Splunk management API; no telemetry or log search is sent."""
    require_administrator(request)
    import requests

    settings = _validate_splunk_settings(candidate.model_dump() if candidate else _read_splunk_settings())
    if not settings["enabled"]:
        return {"connected": False, "message": "Enable the Splunk fallback before testing it."}
    verify_tls = os.getenv("SPLUNK_VERIFY_TLS", "true").lower() == "true"
    try:
        response = requests.get(
            f'{settings["base_url"]}/services/server/info',
            headers={"Authorization": f'Bearer {os.environ["SPLUNK_API_TOKEN"]}'},
            params={"output_mode": "json"},
            timeout=8,
            verify=verify_tls,
        )
        response.raise_for_status()
    except requests.RequestException as error:
        return {"connected": False, "message": "Splunk is not reachable or the token cannot query its management API.", "detail": error.__class__.__name__}
    return {"connected": True, "message": "Splunk is reachable and the API token is accepted. It will be used only if Kubernetes pod-log access fails."}


@app.get("/api/prometheus-settings")
def get_prometheus_settings(request: Request) -> dict:
    require_administrator(request)
    return {"settings": _read_prometheus_settings(), "token_configured": bool(os.getenv("PROMETHEUS_API_TOKEN", "").strip())}


@app.put("/api/prometheus-settings")
def update_prometheus_settings(update: PrometheusSettingsUpdate, request: Request) -> dict:
    actor = require_administrator(request)
    settings = _validate_prometheus_settings(update.model_dump())
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _prometheus_settings_file().write_text(json.dumps(settings, indent=2) + "\n")
    _audit("settings.prometheus_updated", actor, "prometheus", {"enabled": settings["enabled"], "base_url": settings["base_url"]})
    return {"settings": settings, "token_configured": bool(os.getenv("PROMETHEUS_API_TOKEN", "").strip())}


@app.post("/api/prometheus-settings/test")
def test_prometheus_settings(request: Request, candidate: PrometheusSettingsUpdate | None = None) -> dict:
    import requests

    require_administrator(request)
    settings = _validate_prometheus_settings(candidate.model_dump() if candidate else _read_prometheus_settings())
    if not settings["enabled"]:
        return {"connected": False, "message": "Enable Prometheus before testing it."}
    headers = {"Authorization": f'Bearer {os.getenv("PROMETHEUS_API_TOKEN")}' } if os.getenv("PROMETHEUS_API_TOKEN", "").strip() else {}
    try:
        response = requests.get(f'{settings["base_url"]}/api/v1/status/buildinfo', headers=headers, timeout=8, verify=os.getenv("PROMETHEUS_VERIFY_TLS", "true").lower() == "true")
        response.raise_for_status()
    except requests.RequestException as error:
        return {"connected": False, "message": "Prometheus is not reachable or authentication was rejected.", "detail": error.__class__.__name__}
    return {"connected": True, "message": "Prometheus is reachable. PulseOps can use its approved metric mappings for capacity history and forecasting."}


@app.get("/api/url-monitors")
async def url_monitors(request: Request) -> dict:
    require_developer_or_administrator(request)
    monitors = await _check_url_monitors()
    return {
        "monitors": monitors,
        "environments": ["dev", "qa", "uat", "prod"],
        "history": _url_monitor_history_payload(monitors),
        "history_window_hours": 24,
    }


@app.get("/api/operations-intelligence/correlations")
async def operations_intelligence_correlations(request: Request) -> dict:
    require_developer_or_administrator(request)
    snapshot = snapshot_for_user(collector.snapshot(), request.state.user)
    history = collector.observability_report(1440)
    result = _correlate_operations(snapshot, await _check_url_monitors(retain_history=False), history.get("deployment_changes", []))
    comparisons = _deployment_comparisons(snapshot, history)
    result["deployment_comparisons"] = comparisons
    result["deployment_verdicts"] = [{
        "workload": item["workload"], "timestamp": item["changed_at"], "status": item["status"],
        "verdict": "Possible regression" if item["status"] == "regressed" else "Stable after deployment" if item["status"] == "stable" else "Watching this deployment",
        "detail": "Readiness, errors, restarts, CPU, or memory worsened after the image change." if item["status"] == "regressed" else "The available before-and-after evidence shows no material regression." if item["status"] == "stable" else "The release has been observed; more before-and-after evidence is being collected.",
    } for item in comparisons[:6]]
    result["operational_timeline"] = _operational_change_timeline(history)
    result["recoveries"] = _recovery_timeline(history)
    return result


@app.post("/api/url-monitors")
def create_url_monitor(create: UrlMonitorCreate, request: Request) -> dict:
    actor = require_administrator(request)
    monitor = {"id": str(uuid4()), **_validated_monitor(create), "created_at": datetime.now(timezone.utc).isoformat()}
    monitors = _read_url_monitors()
    monitors.append(monitor)
    _write_url_monitors(monitors)
    _audit("url_monitor.created", actor, monitor["name"], {"environment": monitor["environment"], "url": monitor["url"]})
    return {"monitor": monitor}


@app.put("/api/url-monitors/{monitor_id}")
def update_url_monitor(monitor_id: str, update: UrlMonitorUpdate, request: Request) -> dict:
    actor = require_administrator(request)
    monitors = _read_url_monitors()
    for index, existing in enumerate(monitors):
        if existing.get("id") == monitor_id:
            monitor = {**existing, **_validated_monitor(update), "updated_at": datetime.now(timezone.utc).isoformat()}
            monitors[index] = monitor
            _write_url_monitors(monitors)
            _audit("url_monitor.updated", actor, monitor["name"], {"environment": monitor["environment"], "enabled": monitor["enabled"]})
            return {"monitor": monitor}
    raise HTTPException(status_code=404, detail="URL monitor was not found.")


@app.delete("/api/url-monitors/{monitor_id}")
def delete_url_monitor(monitor_id: str, request: Request) -> dict:
    actor = require_administrator(request)
    monitors = _read_url_monitors()
    monitor = next((item for item in monitors if item.get("id") == monitor_id), None)
    if not monitor:
        raise HTTPException(status_code=404, detail="URL monitor was not found.")
    _write_url_monitors([item for item in monitors if item.get("id") != monitor_id])
    _audit("url_monitor.deleted", actor, monitor["name"], {"environment": monitor["environment"]})
    return {"deleted": True}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(ROOT / "static" / "index.html")
