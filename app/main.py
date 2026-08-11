from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from typing import Any
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware
from authlib.integrations.starlette_client import OAuth

from app.observability import AlertEngine, ClusterClient, ClusterConnectionError, TelemetryCollector, answer_operations_question
from app.auth import AccountLockedError, LocalAuth


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
client = ClusterClient()
alerts = AlertEngine()
collector = TelemetryCollector(client, alerts)
auth = LocalAuth(DATA_DIR)


@asynccontextmanager
async def lifespan(_: FastAPI):
    collector.start()
    try:
        yield
    finally:
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


@app.get("/")
def index() -> FileResponse:
    return FileResponse(ROOT / "static" / "index.html")
