from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from difflib import get_close_matches
import json
import os
from pathlib import Path
import re
import time
import gzip
from threading import Event, Lock, Thread
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from prometheus_client import Gauge
import requests


CONTAINER_MEMORY_BYTES = Gauge("pulseops_container_memory_bytes", "Current Docker container memory usage", ["container"])
CONTAINER_CPU_MILLICORES = Gauge("pulseops_container_cpu_millicores", "Current Docker container CPU usage", ["container"])
CONTAINER_RUNNING = Gauge("pulseops_container_running", "Whether the Docker container is running", ["container"])

DEFAULT_ALERT_RULES = [
    {"id": "memory-high", "name": "High memory usage", "metric": "memory_percent", "threshold": 85.0, "severity": "warning", "enabled": True, "description": "Container memory is approaching its configured limit."},
    {"id": "cpu-high", "name": "High CPU usage", "metric": "cpu_percent", "threshold": 85.0, "severity": "warning", "enabled": True, "description": "Container CPU usage is sustained near its configured limit."},
    {"id": "restart-loop", "name": "Restart loop", "metric": "restarts", "threshold": 3.0, "severity": "critical", "enabled": True, "description": "Container restart count indicates an unstable workload."},
    {"id": "log-errors", "name": "Log error spike", "metric": "errors", "threshold": 5.0, "severity": "warning", "enabled": True, "description": "Recent container logs contain repeated error signals."},
]

class ClusterConnectionError(RuntimeError):
    """Live Kubernetes/OpenShift telemetry is unavailable."""


def _splunk_log_settings() -> dict[str, Any]:
    """Read non-secret Splunk fallback settings; the token always stays in the environment."""
    settings = {
        "enabled": os.getenv("SPLUNK_ENABLED", "false").lower() == "true",
        "base_url": os.getenv("SPLUNK_BASE_URL", "").rstrip("/"),
        "index": os.getenv("SPLUNK_INDEX", "main"),
        "pod_field": os.getenv("SPLUNK_POD_FIELD", "kubernetes.pod_name"),
        "scope_field": os.getenv("SPLUNK_SCOPE_FIELD", "kubernetes.namespace"),
        "scope_value": os.getenv("SPLUNK_SCOPE_VALUE", ""),
        "lookback_minutes": int(os.getenv("SPLUNK_LOOKBACK_MINUTES", "15")),
    }
    try:
        saved = json.loads((Path(os.getenv("DATA_DIR", "/data")) / "splunk-settings.json").read_text())
        if isinstance(saved, dict):
            settings.update({key: saved[key] for key in settings if key in saved})
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    settings["base_url"] = str(settings["base_url"]).rstrip("/")
    settings["index"] = str(settings["index"])
    settings["pod_field"] = str(settings["pod_field"])
    settings["scope_field"] = str(settings["scope_field"])
    settings["scope_value"] = str(settings["scope_value"])
    settings["lookback_minutes"] = max(15, min(int(settings["lookback_minutes"]), 43200))
    return settings


def _prometheus_settings() -> dict[str, Any]:
    settings = {"enabled": os.getenv("PROMETHEUS_ENABLED", "true").lower() == "true", "base_url": os.getenv("PROMETHEUS_URL", "http://prometheus:9090").rstrip("/")}
    try:
        saved = json.loads((Path(os.getenv("DATA_DIR", "/data")) / "prometheus-settings.json").read_text())
        if isinstance(saved, dict):
            settings.update({key: saved[key] for key in settings if key in saved})
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return {"enabled": bool(settings["enabled"]), "base_url": str(settings["base_url"]).rstrip("/")}


def _splunk_safe_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


@dataclass
class Pod:
    name: str
    namespace: str
    status: str
    restarts: int
    cpu_millicores: float
    cpu_limit_millicores: float
    memory_mib: float
    memory_limit_mib: float
    node: str
    container_id: str = ""
    image: str = ""
    created_at: str = ""
    ports: str = ""
    reason: str = ""

    @property
    def cpu_percent(self) -> float:
        return round((self.cpu_millicores / self.cpu_limit_millicores) * 100, 1)

    @property
    def memory_percent(self) -> float:
        return round((self.memory_mib / self.memory_limit_mib) * 100, 1)

    @property
    def risk(self) -> str:
        if self.status not in {"Running", "Succeeded", "Observed"} or self.restarts >= 3:
            return "critical"
        if self.memory_percent >= 85 or self.cpu_percent >= 85:
            return "warning"
        return "healthy"

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "cpu_percent": self.cpu_percent, "memory_percent": self.memory_percent, "risk": self.risk}


def _quantity_to_mib(value: str) -> float:
    if value.endswith("Ki"):
        return float(value[:-2]) / 1024
    if value.endswith("Mi"):
        return float(value[:-2])
    if value.endswith("Gi"):
        return float(value[:-2]) * 1024
    return float(value) / (1024 * 1024)


def _quantity_to_millicores(value: str) -> float:
    return float(value[:-1]) if value.endswith("m") else float(value) * 1000


class ClusterClient:
    """Read-only client for live local Docker or Kubernetes/OpenShift data."""

    def __init__(self) -> None:
        self.target = os.getenv("MONITORING_TARGET", "docker").lower()
        self.active_source = self.target
        self.container_prefix = os.getenv("MONITORING_CONTAINER_PREFIX", "mindspark-")
        self.namespace = os.getenv("KUBERNETES_NAMESPACE", "mindspark-official")
        self.log_tail_lines = int(os.getenv("LOG_TAIL_LINES", "100"))

    @staticmethod
    def _configure() -> None:
        from kubernetes import config

        try:
            config.load_incluster_config()
        except config.ConfigException:
            config.load_kube_config()

    def pods(self) -> list[Pod]:
        if self.target == "docker":
            self.active_source = "docker"
            return self._docker_pods()
        if self.target == "splunk":
            self.active_source = "splunk"
            return self._splunk_pods()
        try:
            from kubernetes import client

            self._configure()
            core, metrics_api = client.CoreV1Api(), client.CustomObjectsApi()
            selected = core.list_namespaced_pod(self.namespace).items
            metrics = metrics_api.list_namespaced_custom_object("metrics.k8s.io", "v1beta1", self.namespace, "pods")
            metrics_by_name = {item["metadata"]["name"]: item for item in metrics.get("items", [])}
            result = []
            for item in selected:
                limits = [container.resources.limits or {} for container in item.spec.containers]
                cpu_limit = sum(_quantity_to_millicores(values.get("cpu", "1")) for values in limits)
                memory_limit = sum(_quantity_to_mib(values.get("memory", "512Mi")) for values in limits)
                usage = metrics_by_name.get(item.metadata.name, {}).get("containers", [])
                cpu = sum(_quantity_to_millicores(row["usage"].get("cpu", "0")) for row in usage)
                memory = sum(_quantity_to_mib(row["usage"].get("memory", "0")) for row in usage)
                restarts = sum(status.restart_count for status in (item.status.container_statuses or []))
                result.append(Pod(item.metadata.name, item.metadata.namespace, item.status.phase, restarts, cpu, max(cpu_limit, 1), memory, max(memory_limit, 1), item.spec.node_name or "unassigned", reason=item.status.reason or ""))
            self.active_source = "kubernetes"
            return result
        except Exception as error:
            try:
                result = self._splunk_pods()
                self.active_source = "splunk"
                return result
            except Exception:
                raise ClusterConnectionError("Unable to read live pod metrics. Verify OpenShift login, namespace, kubeconfig mount, and Metrics API permissions, or configure Splunk external monitoring.") from error

    def _splunk_pods(self) -> list[Pod]:
        """Build a workload inventory from recent indexed Kubernetes logs, without Kubernetes API access."""
        settings, headers, verify_tls = self._splunk_connection()
        field = settings["pod_field"]
        count = 5000
        scope = f'{settings["scope_field"]}="{_splunk_safe_value(settings["scope_value"])}" ' if settings["scope_value"] else ""
        search = (
            f'search index="{settings["index"]}" earliest=-{settings["lookback_minutes"]}m '
            f'{scope}| stats latest(_time) as last_seen by {field} | sort 0 - last_seen | head {count}'
        )
        response = requests.post(
            f'{settings["base_url"]}/services/search/jobs',
            headers=headers,
            data={"search": search, "output_mode": "json", "exec_mode": "oneshot", "count": count},
            timeout=12,
            verify=verify_tls,
        )
        response.raise_for_status()
        items = response.json().get("results", [])
        pods: list[Pod] = []
        for item in items if isinstance(items, list) else []:
            name = str(item.get(field, "")).strip()
            if not name:
                continue
            pods.append(Pod(name, "splunk-index", "Observed", 0, 0, 1, 0, 1, "Splunk", created_at=str(item.get("last_seen", ""))))
        if not pods:
            raise ClusterConnectionError("Splunk returned no recent pod records for the configured index and pod field.")
        return pods

    def _docker_pods(self) -> list[Pod]:
        try:
            import docker

            api = docker.from_env()
            containers = [item for item in api.containers.list(all=True) if item.name.startswith(self.container_prefix)]
            result = []
            for container in containers:
                state = container.attrs.get("State", {})
                raw_status = state.get("Status", "unknown")
                status = {"running": "Running", "exited": "Exited", "created": "Pending"}.get(raw_status, raw_status.title())
                stats = container.stats(stream=False) if raw_status == "running" else {}
                cpu_stats, previous_cpu = stats.get("cpu_stats", {}), stats.get("precpu_stats", {})
                cpu_delta = cpu_stats.get("cpu_usage", {}).get("total_usage", 0) - previous_cpu.get("cpu_usage", {}).get("total_usage", 0)
                system_delta = cpu_stats.get("system_cpu_usage", 0) - previous_cpu.get("system_cpu_usage", 0)
                online_cpus = cpu_stats.get("online_cpus") or len(cpu_stats.get("cpu_usage", {}).get("percpu_usage", [])) or 1
                cpu_percent = (cpu_delta / system_delta * online_cpus * 100) if system_delta > 0 and cpu_delta >= 0 else 0
                memory_stats = stats.get("memory_stats", {})
                memory_mib = memory_stats.get("usage", 0) / (1024 * 1024)
                memory_limit_mib = max(memory_stats.get("limit", 512 * 1024 * 1024) / (1024 * 1024), 1)
                CONTAINER_MEMORY_BYTES.labels(container=container.name).set(memory_mib * 1024 * 1024)
                CONTAINER_CPU_MILLICORES.labels(container=container.name).set(cpu_percent * 10)
                CONTAINER_RUNNING.labels(container=container.name).set(1 if raw_status == "running" else 0)
                result.append(Pod(
                    name=container.name,
                    namespace="local-docker",
                    status=status,
                    restarts=container.attrs.get("RestartCount", 0),
                    cpu_millicores=round(cpu_percent * 10, 1),
                    cpu_limit_millicores=1000,
                    memory_mib=round(memory_mib, 1),
                    memory_limit_mib=round(memory_limit_mib, 1),
                    node="local-machine",
                    container_id=container.short_id,
                    image=container.attrs.get("Config", {}).get("Image", "unknown"),
                    created_at=container.attrs.get("Created", ""),
                    ports=", ".join(
                        f"{internal} → {binding[0].get('HostPort', '')}"
                        for internal, binding in (container.attrs.get("NetworkSettings", {}).get("Ports", {}) or {}).items()
                        if binding
                    ) or "No published ports",
                ))
            return result
        except Exception as error:
            raise ClusterConnectionError("Unable to read local Docker telemetry. Start Docker Desktop and allow this dashboard to access the Docker socket.") from error

    def logs(self, pods: list[Pod]) -> dict[str, list[str]]:
        if self.target == "docker":
            return self._docker_logs(pods)
        if self.active_source == "splunk" or self.target == "splunk":
            return self._splunk_logs(pods)
        try:
            from kubernetes import client

            self._configure()
            core = client.CoreV1Api()
            return {
                pod.name: core.read_namespaced_pod_log(name=pod.name, namespace=pod.namespace, tail_lines=self.log_tail_lines, timestamps=True).splitlines()
                for pod in pods
            }
        except Exception as error:
            try:
                return self._splunk_logs(pods)
            except Exception:
                raise ClusterConnectionError("Unable to read live pod logs. Grant read-only pods/log access to the monitoring identity, or configure the optional Splunk log fallback.") from error

    def pod_events(self, pods: list[Pod]) -> list[dict[str, Any]]:
        """Return recent native Kubernetes events for the currently monitored pods.

        Events are deliberately read-only and optional: Docker and Splunk do not
        provide an equivalent Kubernetes event stream, and missing event
        permission must never prevent normal pod monitoring.
        """
        if self.target == "docker" or self.active_source == "splunk" or self.target == "splunk":
            return []
        try:
            from kubernetes import client

            self._configure()
            names = {pod.name for pod in pods}
            items = client.CoreV1Api().list_namespaced_event(self.namespace).items
            results = []
            for item in items:
                involved = getattr(item, "involved_object", None)
                if not involved or getattr(involved, "kind", "") != "Pod" or getattr(involved, "name", "") not in names:
                    continue
                reason = str(getattr(item, "reason", "Kubernetes event") or "Kubernetes event")
                message = str(getattr(item, "message", "") or reason)
                kind = "warning" if str(getattr(item, "type", "Normal")).casefold() == "warning" else "normal"
                lowered = f"{reason} {message}".casefold()
                severity = "critical" if any(token in lowered for token in ("failed", "backoff", "oom", "evict", "unhealthy")) else "warning" if kind == "warning" else "healthy"
                moment = getattr(item, "event_time", None) or getattr(item, "last_timestamp", None) or getattr(item, "first_timestamp", None) or getattr(getattr(item, "metadata", None), "creation_timestamp", None)
                results.append({"pod": involved.name, "source": "kubernetes", "kind": "kubernetes-event", "severity": severity, "reason": reason, "message": message, "timestamp": moment.isoformat() if moment else None, "count": int(getattr(item, "count", 1) or 1)})
            return sorted(results, key=lambda event: event.get("timestamp") or "", reverse=True)[:100]
        except Exception:
            return []

    def stream_logs(self, pod: Pod):
        """Yield new log lines from one read-only workload log stream.

        Unlike the dashboard sample, this follows a single selected workload.
        Splunk is intentionally excluded because its search API is not a safe
        equivalent of a continuously-followed pod log stream.
        """
        if self.target == "splunk" or self.active_source == "splunk":
            raise ClusterConnectionError("Direct Live Tail is unavailable for Splunk external source. Use the sampled log search instead.")
        if self.target == "docker":
            try:
                import docker

                container = docker.from_env().containers.get(pod.name)
                # Include an immediate recent window, then follow every new line.
                # This makes a quiet workload useful to investigate without waiting
                # for the next request or error.
                for raw in container.logs(stream=True, follow=True, tail=self.log_tail_lines, timestamps=True):
                    line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                    if line:
                        yield line
                return
            except Exception as error:
                raise ClusterConnectionError("Unable to open the local container log stream.") from error
        try:
            from kubernetes import client

            self._configure()
            core = client.CoreV1Api()
            response = core.read_namespaced_pod_log(
                name=pod.name,
                namespace=pod.namespace,
                follow=True,
                tail_lines=self.log_tail_lines,
                timestamps=True,
                _preload_content=False,
            )
            try:
                for raw in response.stream():
                    line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                    if line:
                        yield line
            finally:
                response.close()
        except ClusterConnectionError:
            raise
        except Exception as error:
            raise ClusterConnectionError("Unable to open the Kubernetes pod log stream. Verify read-only pods/log permission.") from error

    def _splunk_logs(self, pods: list[Pod]) -> dict[str, list[str]]:
        """Retrieve recent logs from Splunk only after the Kubernetes pod-log API fails."""
        settings, headers, verify_tls = self._splunk_connection()

        names = [pod.name for pod in pods]
        if not names:
            return {}
        field = settings["pod_field"]
        clauses = " OR ".join(f'{field}="{_splunk_safe_value(name)}"' for name in names)
        scope = f'{settings["scope_field"]}="{_splunk_safe_value(settings["scope_value"])}" ' if settings["scope_value"] else ""
        count = min(max(self.log_tail_lines * len(names), self.log_tail_lines), 1000)
        search = (
            f'search index="{settings["index"]}" earliest=-{settings["lookback_minutes"]}m '
            f'{scope}({clauses}) | fields _time {field} _raw | sort 0 - _time | head {count}'
        )
        response = requests.post(
            f'{settings["base_url"]}/services/search/jobs',
            headers=headers,
            data={"search": search, "output_mode": "json", "exec_mode": "oneshot", "count": count},
            timeout=12,
            verify=verify_tls,
        )
        response.raise_for_status()
        result = response.json().get("results", [])
        logs = {name: [] for name in names}
        for item in result if isinstance(result, list) else []:
            name = str(item.get(field, ""))
            if name not in logs:
                continue
            raw = str(item.get("_raw") or item.get("message") or "")
            timestamp = str(item.get("_time", ""))
            logs[name].append(f"{timestamp} {raw}".strip())
        return {name: list(reversed(lines[-self.log_tail_lines:])) for name, lines in logs.items()}

    @staticmethod
    def _splunk_connection() -> tuple[dict[str, Any], dict[str, str], bool]:
        settings = _splunk_log_settings()
        token = os.getenv("SPLUNK_API_TOKEN", "").strip()
        if not settings["enabled"] or not settings["base_url"] or not token:
            raise ClusterConnectionError("Splunk external monitoring is not enabled or its API token is unavailable.")
        parsed = urlparse(settings["base_url"])
        allowed_hosts = {item.strip().lower() for item in os.getenv("SPLUNK_ALLOWED_HOSTS", "").split(",") if item.strip()}
        allow_http = os.getenv("SPLUNK_ALLOW_HTTP", "false").lower() == "true"
        if not allowed_hosts or not parsed.hostname or parsed.hostname.lower() not in allowed_hosts or parsed.scheme not in ({"https", "http"} if allow_http else {"https"}):
            raise ClusterConnectionError("Splunk host is not approved by SPLUNK_ALLOWED_HOSTS.")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", settings["index"]) or not re.fullmatch(r"[A-Za-z0-9_.]+", settings["pod_field"]) or (settings["scope_value"] and not re.fullmatch(r"[A-Za-z0-9_.:-]+", settings["scope_field"])):
            raise ClusterConnectionError("Splunk index or pod field contains unsupported characters.")
        return settings, {"Authorization": f"Bearer {token}"}, os.getenv("SPLUNK_VERIFY_TLS", "true").lower() == "true"

    def _docker_logs(self, pods: list[Pod]) -> dict[str, list[str]]:
        try:
            import docker

            api = docker.from_env()
            return {
                pod.name: api.containers.get(pod.name).logs(tail=self.log_tail_lines, timestamps=True).decode("utf-8", errors="replace").splitlines()
                for pod in pods
            }
        except Exception as error:
            raise ClusterConnectionError("Unable to read local container logs from Docker.") from error

    def inventory(self, pods: list[Pod]) -> dict[str, Any]:
        """Return workload delivery details without changing the monitored platform."""
        if self.target == "docker":
            return self._docker_inventory(pods)
        if self.active_source == "splunk" or self.target == "splunk":
            return self._splunk_inventory(pods)
        return self._kubernetes_inventory(pods)

    def _splunk_inventory(self, pods: list[Pod]) -> dict[str, Any]:
        workloads: dict[str, dict[str, Any]] = {}
        for pod in pods:
            name = re.sub(r"-[a-f0-9]{8,12}-[a-z0-9]{5}$", "", pod.name)
            name = re.sub(r"-\d+$", "", name)
            workload = workloads.setdefault(name or pod.name, {"name": name or pod.name, "type": "Splunk observed workload", "desired": 0, "available": 0, "completed": 0, "exposed": False, "image": "Not available from logs"})
            workload["desired"] += 1
            workload["available"] += 1
        items = [{**item, "status": "Observed"} for item in sorted(workloads.values(), key=lambda value: value["name"])]
        return {"workloads": items, "summary": {"deployments": len(items), "running_deployments": len(items), "services": 0, "exposed_services": 0, "running_pods": len(pods), "pending_pods": 0, "total_restarts": 0, "nodes": 0}}

    @staticmethod
    def _fallback_inventory(pods: list[Pod]) -> dict[str, Any]:
        running = sum(pod.status == "Running" for pod in pods)
        return {
            "workloads": [],
            "summary": {
                "deployments": 0,
                "running_deployments": 0,
                "services": 0,
                "exposed_services": 0,
                "running_pods": running,
                "pending_pods": len(pods) - running,
                "total_restarts": sum(pod.restarts for pod in pods),
                "nodes": len({pod.node for pod in pods}),
            },
        }

    def _docker_inventory(self, pods: list[Pod]) -> dict[str, Any]:
        try:
            import docker

            api = docker.from_env()
            containers = [item for item in api.containers.list(all=True) if item.name.startswith(self.container_prefix)]
            services: dict[str, dict[str, Any]] = {}
            for container in containers:
                labels = container.attrs.get("Config", {}).get("Labels", {}) or {}
                name = labels.get("com.docker.compose.service") or container.name
                state = container.attrs.get("State", {})
                service = services.setdefault(name, {"name": name, "type": "Docker service", "desired": 0, "available": 0, "completed": 0, "exposed": False, "images": [], "containers": [], "published_ports": [], "deployed_at": state.get("StartedAt") or container.attrs.get("Created", "")})
                completed = state.get("Status") == "exited" and state.get("ExitCode") == 0
                if completed:
                    service["completed"] += 1
                else:
                    service["desired"] += 1
                    service["available"] += state.get("Status") == "running"
                published_ports = container.attrs.get("NetworkSettings", {}).get("Ports", {}) or {}
                service["exposed"] = service["exposed"] or any(binding for binding in published_ports.values())
                image = container.attrs.get("Config", {}).get("Image")
                if image and image not in service["images"]:
                    service["images"].append(image)
                for container_port, bindings in published_ports.items():
                    for binding in bindings or []:
                        host_port = binding.get("HostPort")
                        if host_port:
                            service["published_ports"].append(f"localhost:{host_port} → {container_port}")
                service["containers"].append({"name": container.name, "image": image or "Not available", "requests": {}, "limits": {}, "environment_variables": [], "environment_sources": [], "status": state.get("Status", "unknown"), "started_at": state.get("StartedAt") or ""})
            workloads = [
                {**service, "image": ", ".join(service.pop("images", [])) or "Not available", "status": "Completed" if service["desired"] == 0 and service["completed"] else "Ready" if service["available"] == service["desired"] else "Degraded", "updated": None, "unavailable": max(service["desired"] - service["available"], 0), "services": [{"name": service["name"], "type": "Docker service", "ports": sorted(set(service["published_ports"])) or ["Internal network only"], "selector": {}, "routes": sorted(set(service["published_ports"]))}], "routes": sorted(set(service["published_ports"])), "revision": "", "conditions": [], "labels": {}, "strategy": "Docker Compose (local test)"}
                for service in sorted(services.values(), key=lambda item: item["name"])
            ]
            running = sum(pod.status == "Running" for pod in pods)
            return {
                "workloads": workloads,
                "summary": {
                    "deployments": len(workloads),
                    "running_deployments": sum(item["status"] == "Ready" for item in workloads),
                    "services": len(workloads),
                    "exposed_services": sum(item["exposed"] for item in workloads),
                    "running_pods": running,
                    "pending_pods": len(pods) - running,
                    "total_restarts": sum(pod.restarts for pod in pods),
                    "nodes": len({pod.node for pod in pods}),
                },
            }
        except Exception:
            return self._fallback_inventory(pods)

    def _kubernetes_inventory(self, pods: list[Pod]) -> dict[str, Any]:
        try:
            from kubernetes import client

            self._configure()
            apps, core = client.AppsV1Api(), client.CoreV1Api()
            deployments = apps.list_namespaced_deployment(self.namespace).items
            statefulsets = apps.list_namespaced_stateful_set(self.namespace).items
            services = core.list_namespaced_service(self.namespace).items
            routes_by_service: dict[str, list[str]] = {}
            try:
                networking = client.NetworkingV1Api()
                for ingress in networking.list_namespaced_ingress(self.namespace).items:
                    for rule in ingress.spec.rules or []:
                        for path in getattr(rule.http, "paths", []) or []:
                            service_name = getattr(getattr(path.backend, "service", None), "name", None)
                            if service_name and rule.host:
                                routes_by_service.setdefault(service_name, []).append(f"{rule.host}{path.path or ''}")
            except Exception:
                pass
            try:
                route_api = client.CustomObjectsApi()
                for route in route_api.list_namespaced_custom_object("route.openshift.io", "v1", self.namespace, "routes").get("items", []):
                    service_name = route.get("spec", {}).get("to", {}).get("name")
                    host = route.get("spec", {}).get("host") or ((route.get("status", {}).get("ingress") or [{}])[0].get("host"))
                    if service_name and host:
                        routes_by_service.setdefault(service_name, []).append(host)
            except Exception:
                pass
            workloads = []
            def safe_containers(containers: list[Any]) -> list[dict[str, Any]]:
                details = []
                for container in containers or []:
                    resources = container.resources or client.V1ResourceRequirements()
                    env_names = [entry.name for entry in (container.env or []) if entry.name]
                    sources = []
                    for entry in container.env or []:
                        value_from = entry.value_from
                        if value_from and value_from.config_map_key_ref and value_from.config_map_key_ref.name:
                            sources.append(f"ConfigMap: {value_from.config_map_key_ref.name}")
                        if value_from and value_from.secret_key_ref and value_from.secret_key_ref.name:
                            sources.append(f"Secret: {value_from.secret_key_ref.name}")
                    for source in container.env_from or []:
                        if source.config_map_ref and source.config_map_ref.name:
                            sources.append(f"ConfigMap: {source.config_map_ref.name}")
                        if source.secret_ref and source.secret_ref.name:
                            sources.append(f"Secret: {source.secret_ref.name}")
                    details.append({"name": container.name, "image": container.image, "requests": dict(resources.requests or {}), "limits": dict(resources.limits or {}), "environment_variables": env_names, "environment_sources": sorted(set(sources))})
                return details

            def safe_volumes(volumes: list[Any]) -> list[str]:
                references = []
                for volume in volumes or []:
                    source = volume.config_map
                    if source and source.name:
                        references.append(f"ConfigMap: {source.name}")
                    source = volume.secret
                    if source and source.secret_name:
                        references.append(f"Secret: {source.secret_name}")
                    source = volume.persistent_volume_claim
                    if source and source.claim_name:
                        references.append(f"PVC: {source.claim_name}")
                    if volume.empty_dir is not None:
                        references.append(f"EmptyDir: {volume.name}")
                return sorted(set(references))

            def related_services(labels: dict[str, str]) -> list[dict[str, Any]]:
                results = []
                for service in services:
                    selector = service.spec.selector or {}
                    if not selector or not all(labels.get(key) == value for key, value in selector.items()):
                        continue
                    ports = [f"{port.port}/{port.protocol or 'TCP'} → {port.target_port or port.port}" for port in (service.spec.ports or [])]
                    results.append({"name": service.metadata.name, "type": service.spec.type or "ClusterIP", "ports": ports, "selector": selector, "routes": sorted(set(routes_by_service.get(service.metadata.name, [])))})
                return results

            for item, kind in [*( (entry, "Deployment") for entry in deployments), *((entry, "StatefulSet") for entry in statefulsets)]:
                desired = item.spec.replicas or 0
                available = (item.status.available_replicas or 0) if kind == "Deployment" else (item.status.ready_replicas or 0)
                images = ", ".join(container.image for container in item.spec.template.spec.containers)
                labels = dict(item.spec.template.metadata.labels or {})
                related = related_services(labels)
                conditions = [{"type": condition.type, "status": condition.status, "reason": condition.reason or "", "message": condition.message or ""} for condition in (item.status.conditions or [])]
                progress = next((condition for condition in (item.status.conditions or []) if condition.type == "Progressing"), None)
                deployed_at = getattr(progress, "last_update_time", None) or getattr(progress, "last_transition_time", None) or item.metadata.creation_timestamp
                workloads.append({"name": item.metadata.name, "type": kind, "desired": desired, "available": available, "updated": item.status.updated_replicas or 0, "unavailable": item.status.unavailable_replicas or 0, "exposed": any(service["type"] in {"LoadBalancer", "NodePort"} for service in related), "image": images or "Not available", "status": "Ready" if available >= desired else "Degraded", "services": related, "routes": sorted({route for service in related for route in service.get("routes", [])}), "deployed_at": deployed_at.isoformat() if deployed_at else "", "revision": (item.metadata.annotations or {}).get("deployment.kubernetes.io/revision", ""), "containers": safe_containers(item.spec.template.spec.containers), "configuration_references": safe_volumes(item.spec.template.spec.volumes), "service_account": item.spec.template.spec.service_account_name or "default", "conditions": conditions, "labels": labels, "strategy": getattr(getattr(item.spec, "strategy", None), "type", None) or ("RollingUpdate" if kind == "Deployment" else "OrderedReady")})
            running = sum(pod.status == "Running" for pod in pods)
            return {
                "workloads": sorted(workloads, key=lambda item: item["name"]),
                "summary": {
                    "deployments": len(workloads),
                    "running_deployments": sum(item["status"] == "Ready" for item in workloads),
                    "services": len(services),
                    "exposed_services": sum(item.spec.type in {"LoadBalancer", "NodePort"} for item in services),
                    "running_pods": running,
                    "pending_pods": len(pods) - running,
                    "total_restarts": sum(pod.restarts for pod in pods),
                    "nodes": len({pod.node for pod in pods}),
                },
            }
        except Exception:
            return self._fallback_inventory(pods)


def analyse_logs(lines: list[str]) -> dict[str, Any]:
    patterns = {"errors": r"\b(ERROR|exception|failed|refused)\b", "warnings": r"\bWARN\b", "oom_events": r"\bOOMKilled|out of memory|memory pressure\b", "crash_loops": r"\bCrashLoopBackOff\b", "latency_events": r"\bduration_ms=([5-9]\d{2,}|\d{4,})|timeout\b"}
    combined = "\n".join(lines)
    counts = {label: len(re.findall(pattern, combined, flags=re.IGNORECASE)) for label, pattern in patterns.items()}
    severity = "critical" if counts["oom_events"] or counts["crash_loops"] else "warning" if counts["errors"] else "healthy"
    findings = []
    if counts["oom_events"]:
        findings.append("Memory exhaustion detected; investigate the workload or raise its limit.")
    if counts["crash_loops"]:
        findings.append("Restart loop detected; inspect startup dependencies and configuration.")
    if counts["latency_events"]:
        findings.append("Slow or timed-out downstream activity detected.")
    if not findings:
        findings.append("No critical pattern found in the live log sample.")
    recurring = Counter(re.sub(r"\d+", "#", line) for line in lines if re.search(r"ERROR|WARN", line, re.I))
    return {"severity": severity, "counts": counts, "findings": findings, "recurring_patterns": [item[0] for item in recurring.most_common(3)]}


def structure_logs(lines: list[str]) -> list[dict[str, Any]]:
    """Expose every log line in a safe, consistent JSON structure."""
    records: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        raw = _mask_sensitive_log_content(line)
        timestamp, message = "", raw
        match = re.match(r"^(\S+)\s+(.*)$", raw)
        if match and ("T" in match.group(1) or match.group(1).startswith("20")):
            timestamp, message = match.group(1), match.group(2)
        level_match = re.search(r"\b(CRITICAL|ERROR|WARN(?:ING)?|INFO|DEBUG)\b", message, re.IGNORECASE)
        level = (level_match.group(1).upper().replace("WARNING", "WARN").lower() if level_match else "info")
        # Preserve common structured values (request IDs, HTTP status, exception
        # codes) so the UI can show them without altering the original log line.
        fields = {key.casefold(): value.strip('"\'') for key, value in re.findall(r"([A-Za-z][A-Za-z0-9_.-]{1,50})=([^\s,;]+)", message)}
        records.append({"index": index, "timestamp": timestamp or None, "level": level, "message": message, "raw": raw, "fields": fields})
    return records


def _mask_sensitive_log_content(value: str) -> str:
    """Prevent common credentials from being displayed or exported from logs."""
    value = re.sub(r"(?i)(password|passwd|token|api[_-]?key|secret)\s*([=:])\s*([^\s,;]+)", r"\1\2[REDACTED]", value)
    value = re.sub(r"(?i)(authorization:\s*(?:bearer|basic)\s+)[^\s,;]+", r"\1[REDACTED]", value)
    return re.sub(r"(?i)([?&](?:token|api[_-]?key|password)=)[^&\s]+", r"\1[REDACTED]", value)


def live_memory_status(pod: Pod) -> dict[str, Any]:
    base = {"pod": pod.name, "current_memory_mib": round(pod.memory_mib, 1), "limit_mib": pod.memory_limit_mib, "current_percent": pod.memory_percent, "risk": pod.risk}
    try:
        prometheus = _prometheus_settings()
        if not prometheus["enabled"] or not prometheus["base_url"]:
            return {**base, "available": False, "samples": 0, "message": "Prometheus capacity history is disabled."}
        prometheus_url = prometheus["base_url"]
        now = int(datetime.now(timezone.utc).timestamp())
        headers = {"Authorization": f'Bearer {os.getenv("PROMETHEUS_API_TOKEN")}' } if os.getenv("PROMETHEUS_API_TOKEN", "").strip() else {}
        response = requests.get(
            f"{prometheus_url}/api/v1/query_range",
            params={"query": f'pulseops_container_memory_bytes{{container="{pod.name}"}}', "start": now - 900, "end": now, "step": "5"},
            headers=headers,
            timeout=2,
            verify=os.getenv("PROMETHEUS_VERIFY_TLS", "true").lower() == "true",
        )
        response.raise_for_status()
        values = [value for series in response.json().get("data", {}).get("result", []) for value in series.get("values", [])]
        samples = [(float(timestamp), float(value) / (1024 * 1024)) for timestamp, value in values]
        history = [{"timestamp": int(timestamp), "memory_mib": round(memory, 2)} for timestamp, memory in samples]
        if len(samples) < 3:
            return {**base, "available": False, "samples": len(samples), "history": history, "message": f"Prometheus is collecting history ({len(samples)} samples). Forecast activates after 3 readings."}
        first_time, first_value = samples[0]
        last_time, last_value = samples[-1]
        slope_per_second = (last_value - first_value) / max(last_time - first_time, 1)
        predicted_mib = max(0, last_value + slope_per_second * 900)
        predicted_percent = round(predicted_mib / max(pod.memory_limit_mib, 1) * 100, 1)
        prediction_risk = "critical" if predicted_percent >= 95 else "warning" if predicted_percent >= 85 else "healthy"
        return {**base, "available": True, "samples": len(samples), "history": history, "forecast_memory_mib": round(predicted_mib, 1), "forecast_percent": predicted_percent, "forecast_risk": prediction_risk, "message": "15-minute forecast calculated from live Prometheus history."}
    except (requests.RequestException, ValueError, KeyError, TypeError):
        return {**base, "available": False, "samples": 0, "message": "Prometheus is starting or has not returned container history yet."}


def dashboard_snapshot(client: ClusterClient) -> dict[str, Any]:
    pods = client.pods()
    inventory = client.inventory(pods) if hasattr(client, "inventory") else ClusterClient._fallback_inventory(pods)
    completed_tasks = {item["name"] for item in inventory.get("workloads", []) if item.get("status") == "Completed"}

    def is_completed_task(pod: Pod) -> bool:
        return any(f"-{name}-" in pod.name for name in completed_tasks)

    logs = client.logs(pods)
    pod_events = client.pod_events(pods)
    analysis = {name: analyse_logs(lines) for name, lines in logs.items()}
    rank = {"healthy": 0, "warning": 1, "critical": 2}
    alerts = [
        {
            "pod": pod.name,
            "severity": max(pod.risk, analysis[pod.name]["severity"], key=rank.get),
            "message": (
                f"Container status is {pod.status}."
                if pod.risk == "critical" and pod.status not in {"Running", "Succeeded"}
                else analysis[pod.name]["findings"][0]
            ),
        }
        for pod in pods
        if not is_completed_task(pod) and (pod.risk != "healthy" or analysis[pod.name]["severity"] != "healthy")
    ]
    forecasts = [live_memory_status(pod) for pod in pods]
    structured = {name: structure_logs(lines) for name, lines in logs.items()}
    pod_records = [pod.to_dict() for pod in pods]
    forecast_by_pod = {item["pod"]: item for item in forecasts}
    deployment_details = []
    for workload in inventory.get("workloads", []):
        workload_name = str(workload.get("name", ""))
        resources = [pod for pod in pod_records if f"-{workload_name}-" in pod["name"] or pod["name"].endswith(f"-{workload_name}")]
        # Kubernetes workload names normally match a pod prefix rather than a Compose-style middle segment.
        if not resources:
            resources = [pod for pod in pod_records if pod["name"].startswith(f"{workload_name}-")]
        memory_history: dict[int, list[float]] = {}
        resource_details = []
        for resource in resources:
            forecast = forecast_by_pod.get(resource["name"], {})
            for point in forecast.get("history", []):
                timestamp = int(point.get("timestamp", 0))
                if timestamp:
                    memory_history.setdefault(timestamp, []).append(float(point.get("memory_mib", 0)))
            resource_details.append({"pod": resource, "analysis": analysis.get(resource["name"], {}), "forecast": forecast})
        deployment_details.append({
            "name": workload_name,
            "type": workload.get("type", "Workload"),
            "status": workload.get("status", "Unknown"),
            "image": workload.get("image", "Not available"),
            "desired": workload.get("desired", 0),
            "available": workload.get("available", 0),
            "updated": workload.get("updated", 0),
            "unavailable": workload.get("unavailable", 0),
            "exposed": workload.get("exposed", False),
            "services": workload.get("services", []),
            "containers": workload.get("containers", []),
            "configuration_references": workload.get("configuration_references", []),
            "service_account": workload.get("service_account", "Not reported"),
            "conditions": workload.get("conditions", []),
            "labels": workload.get("labels", {}),
            "strategy": workload.get("strategy", "Not available"),
            "routes": workload.get("routes", []),
            "deployed_at": workload.get("deployed_at", ""),
            "revision": workload.get("revision", ""),
            "resources": resource_details,
            "summary": {
                "resource_count": len(resource_details),
                "cpu_percent": round(sum(item["pod"].get("cpu_percent", 0) for item in resource_details), 1),
                "memory_mib": round(sum(item["pod"].get("memory_mib", 0) for item in resource_details), 1),
                "memory_limit_mib": round(sum(item["pod"].get("memory_limit_mib", 0) for item in resource_details), 1),
                "restarts": sum(item["pod"].get("restarts", 0) for item in resource_details),
            },
            "memory_history": [{"timestamp": timestamp, "memory_mib": round(sum(values), 2)} for timestamp, values in sorted(memory_history.items())],
        })
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "mode": client.active_source, "summary": {"pods": len(pods), "healthy_pods": sum(pod.risk == "healthy" for pod in pods), "average_cpu_percent": round(sum(pod.cpu_percent for pod in pods) / max(len(pods), 1), 1), "average_memory_percent": round(sum(pod.memory_percent for pod in pods) / max(len(pods), 1), 1), "alerts": len(alerts), **inventory["summary"]}, "inventory": inventory, "deployments": deployment_details, "pods": pod_records, "alerts": alerts, "logs": logs, "structured_logs": structured, "pod_events": pod_events, "analysis": analysis, "forecasts": forecasts, "completed_tasks": list(completed_tasks)}


def _question_terms(question: str) -> set[str]:
    ignored = {"a", "an", "and", "any", "are", "can", "do", "for", "from", "how", "i", "in", "is", "it", "me", "of", "on", "please", "show", "the", "there", "to", "what", "which", "why", "with", "would", "you"}
    return {term for term in re.findall(r"[a-z0-9_-]{2,}", question.casefold()) if term not in ignored}


MAX_ASSISTANT_EVIDENCE = 3
MAX_ASSISTANT_EVIDENCE_CHARS = 260

# Internal, explainable operations vocabulary. It expands common operator wording
# without calling an external model or storing an opaque model artifact.
DEFAULT_OPERATIONS_VOCABULARY = {
    "database": {"postgres", "postgresql", "sql", "connection", "query"},
    "db": {"postgres", "postgresql", "sql", "connection"},
    "backend": {"api", "service", "server", "application"},
    "frontend": {"ui", "web", "browser", "angular"},
    "unhealthy": {"error", "warning", "restart", "crash", "oom", "failed"},
    "issue": {"error", "warning", "failed", "restart", "degraded"},
    "slow": {"latency", "timeout", "performance", "cpu"},
    "capacity": {"memory", "cpu", "forecast", "oom"},
    "availability": {"running", "ready", "status", "restart"},
}


def _load_operations_vocabulary() -> dict[str, set[str]]:
    """Load team-owned aliases; malformed entries safely fall back to defaults."""
    vocabulary = {term: set(values) for term, values in DEFAULT_OPERATIONS_VOCABULARY.items()}
    path = Path(os.getenv("OPERATIONS_VOCABULARY_PATH", str(Path(__file__).resolve().parents[1] / "config" / "operations-vocabulary.json")))
    try:
        custom = json.loads(path.read_text())
        for term, values in custom.items():
            if isinstance(term, str) and isinstance(values, list):
                vocabulary[term.casefold()] = {str(value).casefold() for value in values if str(value).strip()}
    except (OSError, ValueError, TypeError):
        pass
    return vocabulary


OPERATIONS_VOCABULARY = _load_operations_vocabulary()


def _assistant_excerpt(text: str, limit: int = MAX_ASSISTANT_EVIDENCE_CHARS) -> str:
    """Keep chat citations scan-friendly, even when a log line is very long."""
    compact = " ".join(str(text).split())
    return compact if len(compact) <= limit else f"{compact[:limit - 1].rstrip()}…"


def _expand_operations_terms(terms: set[str]) -> set[str]:
    expanded = set(terms)
    for term in terms:
        expanded.update(OPERATIONS_VOCABULARY.get(term, set()))
    return expanded


def _retrieve_operations_evidence(snapshot: dict[str, Any], question: str, current_pod: str | None = None) -> list[dict[str, str]]:
    """Retrieve the most relevant masked operational records for a question."""
    terms = _expand_operations_terms(_question_terms(question))
    log_intent = bool(terms & {"log", "logs", "error", "errors", "warning", "warnings", "exception", "exceptions", "crash", "crashes"})
    capacity_intent = bool(terms & {"memory", "forecast", "capacity", "oom"})
    candidates: list[dict[str, str]] = []
    for pod in snapshot.get("pods", []):
        candidates.append({"kind": "workload", "pod": pod["name"], "text": f"{pod['name']} status {pod['status']}; risk {pod['risk']}; CPU {pod['cpu_percent']}%; memory {pod['memory_percent']}% ({pod['memory_mib']} MiB); restarts {pod['restarts']}."})
    for pod_name, analysis in snapshot.get("analysis", {}).items():
        counts = analysis.get("counts", {})
        candidates.append({"kind": "signal", "pod": pod_name, "text": f"{pod_name} analysis: severity {analysis.get('severity', 'healthy')}; errors {counts.get('errors', 0)}; warnings {counts.get('warnings', 0)}; OOM events {counts.get('oom_events', 0)}; findings: {' '.join(analysis.get('findings', []))}"})
    for item in snapshot.get("forecasts", []):
        candidates.append({"kind": "forecast", "pod": item["pod"], "text": f"{item['pod']} memory forecast: current {item['current_percent']}%; " + (f"15-minute forecast {item['forecast_percent']}%." if item.get("available") else item.get("message", "Forecast is collecting history."))})
    for alert in snapshot.get("alerts", []):
        candidates.append({"kind": "alert", "pod": alert["pod"], "text": f"{alert['severity']} alert for {alert['pod']}: {alert['message']}"})
    for pod_name, records in snapshot.get("structured_logs", {}).items():
        for record in records[-100:]:
            if record.get("level") in {"critical", "error", "warn"}:
                candidates.append({"kind": "log", "pod": pod_name, "text": f"{pod_name} {record['level']} log: {record['message']}"})

    # A selected pod is the user's active investigation context. Prefer its
    # telemetry entirely; fall back to cluster-wide evidence only if it has no records.
    if current_pod:
        contextual_candidates = [candidate for candidate in candidates if candidate["pod"] == current_pod]
        if contextual_candidates:
            candidates = contextual_candidates

    def score(candidate: dict[str, str]) -> tuple[int, int]:
        text = candidate["text"].casefold()
        matches = sum(term in text for term in terms)
        if candidate["kind"] == "log" and log_intent:
            matches += 3
        if candidate["kind"] == "forecast" and capacity_intent:
            matches += 3
        if current_pod and candidate["pod"] == current_pod:
            matches += 2
        priority = {"alert": 4, "log": 3, "signal": 2, "forecast": 1, "workload": 0}[candidate["kind"]]
        return matches, priority

    matches = [candidate for candidate in candidates if score(candidate)[0] > 0]
    ranked = sorted(matches or candidates, key=score, reverse=True)
    unique: list[dict[str, str]] = []
    seen: set[str] = set()
    for candidate in ranked:
        if candidate["text"] in seen:
            continue
        unique.append({**candidate, "text": _assistant_excerpt(candidate["text"])})
        seen.add(candidate["text"])
        if len(unique) == MAX_ASSISTANT_EVIDENCE:
            break
    return unique


def _assistant_actions(evidence: list[dict[str, str]], current_pod: str | None, normalized_question: str) -> list[dict[str, str]]:
    pod = next((item["pod"] for item in evidence if item.get("pod")), current_pod)
    if not pod:
        return []
    actions = [{"type": "open-pod", "pod": pod, "label": f"Open {pod}"}]
    if any(word in normalized_question for word in ("log", "error", "warning", "exception", "crash")):
        actions.append({"type": "view-logs", "pod": pod, "label": "View matching logs"})
    return actions


def _pod_name_terms(question_terms: set[str]) -> set[str]:
    ignored = {"pod", "pods", "application", "applications", "app", "apps", "about", "particular", "name", "were", "running", "run", "many", "count", "number", "named", "called", "there", "any", "got", "last", "hour", "hours", "day", "days", "today", "yesterday", "recent", "is", "issue", "issues", "problem", "problems", "health", "healthy", "unhealthy", "check", "status", "needs", "need", "attention", "has", "have", "log", "logs", "string", "text", "message", "present", "contain", "contains", "find", "search", "for", "in", "from", "within", "critical", "criticle", "warning", "warnings", "error", "errors"}
    return {term for term in question_terms - ignored if not term.isdigit()}


def _related_pods(pods: list[dict[str, Any]], requested_terms: set[str]) -> list[str]:
    names = [pod["name"] for pod in pods]
    candidates = [part for name in names for part in name.casefold().replace("_", "-").split("-") if len(part) >= 3]
    related_parts = get_close_matches(" ".join(sorted(requested_terms)), candidates, n=3, cutoff=0.58)
    return [name for name in names if any(part in name.casefold() for part in related_parts)][:3]


def _requested_log_text(question: str) -> str | None:
    quoted = re.search(r"[\"“]([^\"”]{2,120})[\"”]", question)
    if quoted:
        return quoted.group(1).strip()
    match = re.search(r"(?:find|search(?:\s+for)?|check(?:\s+for)?|is)\s+([a-zA-Z0-9_.:/=-]{2,120})\s+(?:present|in|from|within)\s+(?:the\s+)?logs?", question, re.IGNORECASE)
    return match.group(1).strip() if match else None


def _operations_assessment(snapshot: dict[str, Any], evidence: list[dict[str, str]], current_pod: str | None) -> str:
    """Create an explainable, deterministic assessment from live evidence."""
    pods = {pod["name"]: pod for pod in snapshot.get("pods", [])}
    relevant = {item["pod"] for item in evidence} or ({current_pod} if current_pod else set())
    for name in relevant:
        counts = snapshot.get("analysis", {}).get(name, {}).get("counts", {})
        pod = pods.get(name, {})
        if counts.get("oom_events"):
            return f"Likely memory pressure on {name}: live logs contain an OOM signal."
        if counts.get("crash_loops") or pod.get("restarts", 0) >= 3:
            return f"Likely workload instability on {name}: restart/crash-loop signals need investigation."
        if counts.get("errors"):
            return f"Application errors are present on {name}; inspect the matching log context before changing infrastructure."
        if pod.get("status") not in {None, "Running", "Succeeded"}:
            return f"{name} is not running normally ({pod.get('status')}); check its deployment state and recent logs."
    if snapshot.get("alerts"):
        alert = snapshot["alerts"][0]
        return f"The highest current signal is a {alert.get('severity', 'warning')} alert for {alert.get('pod', 'a workload')}."
    return "No correlated failure signal is present in the current telemetry sample."


def _playbook_report(snapshot: dict[str, Any], playbook: str) -> dict[str, Any]:
    """Return a consistent, evidence-based investigation checklist for a service domain."""
    terms = {
        "database": "postgres sql connection error restart memory",
        "backend": "backend api error restart memory cpu timeout",
        "frontend": "frontend ui error restart memory cpu",
        "deployment": "deployment workload ready restart error",
    }[playbook]
    evidence = _retrieve_operations_evidence(snapshot, terms)
    affected = sorted({item["pod"] for item in evidence})
    if playbook == "deployment":
        active = [item for item in snapshot.get("inventory", {}).get("workloads", []) if item.get("status") != "Completed"]
        readiness = f"{sum(item.get('status') == 'Ready' for item in active)}/{len(active)} active workloads ready"
    else:
        readiness = ", ".join(affected) or "no matching live workload"
    answer = "\n".join([
        f"{playbook.title()} playbook",
        f"1. Scope: {readiness}.",
        f"2. Current assessment: {_operations_assessment(snapshot, evidence, None)}",
        "3. Evidence:",
        *[f"• {item['pod']} — {item['text']}" for item in evidence],
        "4. Next check: Open the cited logs and verify the most recent correlated event before making a change.",
    ])
    return {"answer": answer, "evidence": evidence}


def _incident_timeline(snapshot: dict[str, Any], current_pod: str | None) -> dict[str, Any]:
    """Create a short timeline from current alerts, restart history, and recent warning/error logs."""
    items: list[tuple[str, str, str]] = []
    for change in snapshot.get("restart_window", {}).get("changes", []):
        if not current_pod or change["pod"] == current_pod:
            items.append((str(change.get("timestamp", "")), change["pod"], f"restart count increased by {change['increase']}"))
    for alert in snapshot.get("alerts", [])[:5]:
        if not current_pod or alert.get("pod") == current_pod:
            items.append((str(alert.get("timestamp", "")), alert.get("pod", "workload"), f"{alert.get('severity', 'warning')} alert: {alert.get('message', '')}"))
    for pod_name, records in snapshot.get("structured_logs", {}).items():
        if current_pod and pod_name != current_pod:
            continue
        for record in records[-100:]:
            if record.get("level") in {"critical", "error", "warn"}:
                items.append((str(record.get("timestamp") or ""), pod_name, f"{record['level']} log: {record['message']}"))
    timeline = sorted(items, reverse=True)[:6]
    if not timeline:
        answer = "No restart, alert, warning, or error event is present in the current incident timeline."
        evidence: list[dict[str, str]] = []
    else:
        answer = "Current incident timeline:\n" + "\n".join(f"• {pod} — {detail}" for _, pod, detail in timeline)
        evidence = [{"kind": "timeline", "pod": pod, "text": detail} for _, pod, detail in timeline[:MAX_ASSISTANT_EVIDENCE]]
    return {"answer": answer, "evidence": evidence}


def answer_operations_question(snapshot: dict[str, Any], question: str, current_pod: str | None = None) -> dict[str, Any]:
    """Ground each answer in retrieved, masked dashboard telemetry and logs."""
    clean_question = " ".join(question.split())
    normalized = clean_question.casefold()
    summary = snapshot.get("summary", {})
    question_terms = _question_terms(clean_question)
    history = snapshot.get("query_history", {})
    historical_intent = bool(question_terms & {"hour", "hours", "day", "days", "today", "yesterday", "recent"})
    issue_intent = bool(question_terms & {"error", "errors", "issue", "issues", "problem", "problems", "failed", "failure", "unhealthy", "restart", "restarts"})
    if historical_intent and issue_intent:
        relevant = [event for event in history.get("events", []) if event.get("kind") in {"log", "alert", "restart", "runtime", "health", "deployment"} and event.get("severity") != "healthy"]
        requested_names = _pod_name_terms(question_terms)
        available_names = {str(event.get("pod") or event.get("workload") or "platform") for event in relevant}
        matched_names = {name for name in available_names if any(term in name.casefold() for term in requested_names)}
        if requested_names and matched_names:
            relevant = [event for event in relevant if str(event.get("pod") or event.get("workload") or "platform") in matched_names]
        by_pod: dict[str, list[dict[str, Any]]] = {}
        for event in relevant:
            by_pod.setdefault(str(event.get("pod") or event.get("workload") or "platform"), []).append(event)
        hours = max(1, int(history.get("range_minutes", 1440)) // 60)
        if by_pod:
            ranked = sorted(by_pod.items(), key=lambda item: len(item[1]), reverse=True)
            lines, evidence = [], []
            for pod, pod_events in ranked[:5]:
                kinds = Counter(event.get("kind", "signal") for event in pod_events)
                description = ", ".join(f"{count} {kind}" for kind, count in kinds.most_common())
                latest = pod_events[0]
                lines.append(f"• {pod}: {description}; latest: {latest.get('title', 'operational signal')}.")
                evidence.append({"kind": "history", "pod": pod, "text": _assistant_excerpt(f"{latest.get('title', '')}: {latest.get('detail', '')}")})
            matched_note = f" matching {', '.join(sorted(requested_names))}" if requested_names and matched_names else ""
            answer = f"L1ControlScope found {len(relevant)} operational issue signal(s){matched_note} across {len(by_pod)} application/workload(s) in the last {hours} hours.\n" + "\n".join(lines)
        else:
            scope = f" matching {', '.join(sorted(requested_names))}" if requested_names else ""
            answer = f"L1ControlScope found no persisted error, restart, alert, unhealthy-runtime, or deployment-failure signal{scope} in the last {hours} hours."
            evidence = []
        coverage = history.get("coverage", {})
        if not coverage.get("complete", False):
            answer += f"\nCoverage note: L1ControlScope currently has {coverage.get('observed_minutes', 0)} of the requested {coverage.get('requested_minutes', 0)} minutes stored; results cover only that observed period."
        return {"answer": answer, "mode": "app-first-evidence-query", "generated_at": snapshot.get("generated_at"), "sources": ["L1ControlScope operational history", "Persisted masked log signals", "Deployment and restart events"], "evidence": evidence[:MAX_ASSISTANT_EVIDENCE], "actions": _assistant_actions(evidence, None, normalized), "coverage": coverage}
    # Questions about shared platform services must search cluster-wide rather
    # than inheriting the currently selected application pod.
    investigation_pod = current_pod
    if question_terms & {"database", "db", "postgres", "postgresql", "sql", "network", "storage"}:
        investigation_pod = None

    playbook_domains = {
        "database": {"database", "db", "postgres", "postgresql", "sql"},
        "backend": {"backend", "api", "service"},
        "frontend": {"frontend", "ui", "web"},
        "deployment": {"deployment", "deployments", "workload", "workloads"},
    }
    if question_terms & {"playbook", "investigate", "diagnose"}:
        domain = next((name for name, terms in playbook_domains.items() if question_terms & terms), None)
        if domain:
            report = _playbook_report(snapshot, domain)
            return {"answer": report["answer"], "mode": "python-operations-intelligence", "generated_at": snapshot.get("generated_at"), "sources": ["Live workload telemetry", "Masked pod logs", "Alert rules and capacity forecast"], "evidence": report["evidence"], "actions": _assistant_actions(report["evidence"], None, normalized)}

    if question_terms & {"timeline", "incident"}:
        report = _incident_timeline(snapshot, investigation_pod)
        return {"answer": report["answer"], "mode": "python-operations-intelligence", "generated_at": snapshot.get("generated_at"), "sources": ["Restart telemetry history", "Masked pod logs", "Alert rules"], "evidence": report["evidence"], "actions": _assistant_actions(report["evidence"], investigation_pod, normalized)}

    if question_terms <= {"issue", "issues", "problem", "problems", "health", "status", "attention"}:
        completed_tasks = set(snapshot.get("completed_tasks", []))
        active_pods = [pod for pod in snapshot.get("pods", []) if not any(f"-{task}-" in pod["name"] for task in completed_tasks)]
        problematic = [pod for pod in active_pods if pod.get("risk") != "healthy" or snapshot.get("analysis", {}).get(pod["name"], {}).get("severity") != "healthy"]
        if problematic:
            details = ", ".join(f"{pod['name']} ({pod['status']}, {pod['risk']})" for pod in problematic[:3])
            answer = f"Yes. {len(problematic)} active pod issue(s) need attention: {details}."
        else:
            answer = f"No active issue is currently detected across {len(active_pods)} monitored pods."
        return {"answer": answer, "mode": "python-operations-intelligence", "generated_at": snapshot.get("generated_at"), "sources": ["Live pod telemetry", "Masked pod logs", "Alert rules"], "evidence": []}

    if question_terms & {"critical", "criticle"}:
        completed_tasks = set(snapshot.get("completed_tasks", []))
        active_pods = [pod for pod in snapshot.get("pods", []) if not any(f"-{task}-" in pod["name"] for task in completed_tasks)]
        critical = [pod for pod in active_pods if pod.get("risk") == "critical" or snapshot.get("analysis", {}).get(pod["name"], {}).get("severity") == "critical"]
        if critical:
            details = ", ".join(f"{pod['name']} ({pod['status']})" for pod in critical[:3])
            answer = f"Yes. Critical issue(s) are detected on: {details}."
        else:
            answer = f"No critical issue is currently detected across {len(active_pods)} monitored pods."
        return {"answer": answer, "mode": "python-operations-intelligence", "generated_at": snapshot.get("generated_at"), "sources": ["Live pod telemetry", "Masked pod logs", "Alert rules"], "evidence": []}

    pods = snapshot.get("pods", [])
    log_text = _requested_log_text(clean_question)
    pod_name_terms = _pod_name_terms(question_terms) if ({"pod", "pods", "application", "applications", "app", "apps"} & question_terms or log_text) else set()
    named_pods = [pod for pod in pods if any(term in pod["name"].casefold() for term in pod_name_terms)]
    if pod_name_terms and not named_pods and {"pod", "pods"} & question_terms:
        requested_name = ", ".join(sorted(pod_name_terms))
        related = _related_pods(pods, pod_name_terms)
        if related:
            answer = f"I could not find an exact live pod matching “{requested_name}”. Closest available pod name(s): {', '.join(related)}."
        else:
            answer = f"I could not find a live pod matching “{requested_name}”. Check the pod name and try again."
        return {"answer": answer, "mode": "python-operations-intelligence", "generated_at": snapshot.get("generated_at"), "sources": ["Live pod inventory"], "evidence": []}

    if log_text:
        target_pods = named_pods or pods
        matches = [
            {"kind": "log", "pod": pod["name"], "text": f"matching log: {record['message']}"}
            for pod in target_pods
            for record in snapshot.get("structured_logs", {}).get(pod["name"], [])
            if log_text.casefold() in f"{record.get('message', '')} {record.get('raw', '')}".casefold()
        ]
        scope = ", ".join(pod["name"] for pod in target_pods) if named_pods else "all live pods"
        if matches:
            answer = f"Found {len(matches)} log match(es) for “{log_text}” in {scope}."
            evidence = [{**item, "text": _assistant_excerpt(item["text"])} for item in matches[:MAX_ASSISTANT_EVIDENCE]]
        else:
            answer = f"No log entry containing “{log_text}” was found in {scope}."
            evidence = []
        return {"answer": answer, "mode": "python-operations-intelligence", "generated_at": snapshot.get("generated_at"), "sources": ["Masked pod logs"], "evidence": evidence, "actions": _assistant_actions(evidence, named_pods[0]["name"] if named_pods else None, normalized)}

    if {"image", "tag", "version", "digest"} & question_terms:
        target_pods = named_pods or ([pod for pod in pods if pod.get("name") == current_pod] if current_pod else [])
        if target_pods:
            details = []
            evidence = []
            for pod in target_pods[:10]:
                image = str(pod.get("image") or "Not available")
                details.append(f"• {pod['name']}: {image}")
                evidence.append({"kind": "workload", "pod": pod["name"], "text": f"Runtime image: {image}"})
            answer = f"Runtime image information for {len(target_pods)} matching pod(s):\n" + "\n".join(details)
        else:
            requested = ", ".join(sorted(pod_name_terms)) or "the requested pod"
            answer = f"I could not find a live pod matching {requested}, so no runtime image tag or digest can be reported."
            evidence = []
        return {"answer": answer, "mode": "app-first-evidence-query", "generated_at": snapshot.get("generated_at"), "sources": ["Live container runtime metadata"], "evidence": evidence[:MAX_ASSISTANT_EVIDENCE], "actions": _assistant_actions(evidence, target_pods[0]["name"] if target_pods else None, normalized)}

    if named_pods:
        running = [pod for pod in named_pods if pod.get("status") == "Running"]
        details = ", ".join(f"{pod['name']} ({pod['status']})" for pod in named_pods[:3])
        answer = f"{'Yes' if running else 'No'}. {len(running)} of {len(named_pods)} matching pod(s) are currently running: {details}."
        return {"answer": answer, "mode": "local-retrieval-assistant", "generated_at": snapshot.get("generated_at"), "sources": ["Live pod telemetry"], "evidence": []}

    if {"pod", "pods"} & question_terms and {"running", "run", "many", "count", "number"} & question_terms:
        not_running = summary.get("pending_pods", 0)
        suffix = "pod is" if not_running == 1 else "pods are"
        answer = f"{summary.get('running_pods', 0)} of {summary.get('pods', 0)} pods are currently running. {not_running} {suffix} not running."
        return {"answer": answer, "mode": "local-retrieval-assistant", "generated_at": snapshot.get("generated_at"), "sources": ["Live pod telemetry"], "evidence": []}

    if {"deployment", "deployments", "workload", "workloads"} & question_terms and {"running", "run", "ready", "many", "count", "number"} & question_terms:
        answer = f"{summary.get('running_deployments', 0)} of {summary.get('deployments', 0)} deployments/workloads are ready and running."
        return {"answer": answer, "mode": "local-retrieval-assistant", "generated_at": snapshot.get("generated_at"), "sources": ["Live workload inventory"], "evidence": []}

    if {"deployment", "deployments", "workload", "workloads"} & question_terms and {"issue", "issues", "problem", "problems", "unhealthy", "failed", "failure", "status", "health"} & question_terms:
        workloads = snapshot.get("inventory", {}).get("workloads", [])
        active_workloads = [item for item in workloads if item.get("status") != "Completed"]
        degraded = [item for item in active_workloads if item.get("status") != "Ready"]
        if degraded:
            details = ", ".join(f"{item['name']} ({item.get('available', 0)}/{item.get('desired', 0)} ready)" for item in degraded[:3])
            answer = f"Yes. {len(degraded)} deployment/workload issue(s) found: {details}."
        else:
            completed = [item["name"] for item in workloads if item.get("status") == "Completed"]
            completion_note = f" Completed task: {', '.join(completed)}." if completed else ""
            answer = f"No active deployment readiness issue is currently detected. All {len(active_workloads)} active deployments/workloads are ready.{completion_note}"
        return {"answer": answer, "mode": "local-retrieval-assistant", "generated_at": snapshot.get("generated_at"), "sources": ["Live workload inventory"], "evidence": []}

    if {"restart", "restarts", "restarted"} & question_terms:
        restart_window = snapshot.get("restart_window", {})
        changes = restart_window.get("changes", [])
        observed_seconds = restart_window.get("observed_seconds", 0)
        recent_changes = [item for item in changes if item.get("age_seconds", 999999) <= 600]
        if recent_changes:
            details = ", ".join(f"{item['pod']} (+{item['increase']})" for item in recent_changes[:3])
            answer = f"Yes. PulseOps detected {sum(item['increase'] for item in recent_changes)} restart(s) in the last 10 minutes: {details}."
        elif observed_seconds < 600:
            answer = f"No restart increase has been observed since tracking began {max(1, round(observed_seconds / 60))} minute(s) ago. A full 10-minute answer will be available after PulseOps has collected data for 10 minutes. Current total restarts: {summary.get('total_restarts', 0)}."
        else:
            answer = f"No restart increase was detected in the last 10 minutes. Current total restarts across all pods: {summary.get('total_restarts', 0)}."
        return {"answer": answer, "mode": "local-retrieval-assistant", "generated_at": snapshot.get("generated_at"), "sources": ["Restart telemetry history"], "evidence": []}

    navigation_terms = {"saved", "tab", "tabs", "menu", "page", "pages", "screen", "screens", "navigation"}
    if question_terms & navigation_terms:
        answer = "This assistant searches operational data, not saved dashboard views. Use the left navigation to open a workspace, then ask about a specific pod, log error, CPU, memory, restart, alert, or forecast."
        return {"answer": answer, "mode": "local-retrieval-assistant", "generated_at": snapshot.get("generated_at"), "sources": ["PulseOps workspace navigation"], "evidence": []}
    # A named application is a hard boundary, not a relevance boost. This keeps
    # broad concepts such as "database" from pulling unrelated pods at scale.
    pod_names = [str(pod.get("name", "")) for pod in snapshot.get("pods", [])]
    entity_terms = {term for term in question_terms if len(term) >= 3 and any(term in name.casefold() for name in pod_names)}
    scoped_names = {name for name in pod_names if any(term in name.casefold() for term in entity_terms)}
    operational_terms = {
        "database", "db", "postgres", "postgresql", "sql", "backend", "frontend", "service", "network", "storage",
        "memory", "cpu", "capacity", "forecast", "timeout", "latency", "availability", "deployment", "deployments",
        "workload", "workloads", "restart", "restarts", "error", "errors", "warning", "warnings", "critical",
        "issue", "issues", "problem", "problems", "health", "healthy", "unhealthy", "status", "current", "live",
    }
    for key, values in OPERATIONS_VOCABULARY.items():
        operational_terms.add(key)
        operational_terms.update(values)
    explicit_entity_candidates = {term for term in _pod_name_terms(question_terms) if term not in operational_terms}
    if explicit_entity_candidates and not scoped_names:
        requested = ", ".join(sorted(explicit_entity_candidates))
        related = _related_pods(snapshot.get("pods", []), explicit_entity_candidates)
        suggestion = f" Closest monitored pod name(s): {', '.join(related)}." if related else ""
        answer = f"I could not find a monitored application or pod matching “{requested}”. I did not broaden the search to unrelated pods.{suggestion}"
        return {"answer": answer, "mode": "app-first-evidence-query", "generated_at": snapshot.get("generated_at"), "sources": ["Live pod inventory"], "scope": {"requested_application": requested, "matched_pods": [], "strict": True}, "evidence": [], "actions": []}
    evidence_snapshot = snapshot
    if scoped_names:
        evidence_snapshot = {
            **snapshot,
            "pods": [pod for pod in snapshot.get("pods", []) if pod.get("name") in scoped_names],
            "analysis": {name: value for name, value in snapshot.get("analysis", {}).items() if name in scoped_names},
            "logs": {name: value for name, value in snapshot.get("logs", {}).items() if name in scoped_names},
            "structured_logs": {name: value for name, value in snapshot.get("structured_logs", {}).items() if name in scoped_names},
            "forecasts": [item for item in snapshot.get("forecasts", []) if item.get("pod") in scoped_names],
            "alerts": [item for item in snapshot.get("alerts", []) if item.get("pod") in scoped_names],
        }
        investigation_pod = next(iter(scoped_names)) if len(scoped_names) == 1 else None
    evidence = _retrieve_operations_evidence(evidence_snapshot, clean_question, investigation_pod)
    evidence_text = [f"• {item['pod']} — {item['text']}" for item in evidence]
    relevant_pods = {item["pod"] for item in evidence}
    if any(word in normalized for word in ("error", "log", "exception", "warning", "crash")):
        next_step = "Open Pod logs, select the cited workload, then inspect the JSON context around the matching event."
    elif any(word in normalized for word in ("memory", "forecast", "capacity", "oom")):
        next_step = "Compare the cited memory forecast with its recent logs before changing a limit or scaling the workload."
    elif any(word in normalized for word in ("cpu", "slow", "latency", "performance")):
        next_step = "Check the cited workload's logs and deployment history for a correlated traffic or release change."
    elif any(word in normalized for word in ("alert", "health", "status", "attention", "issue")):
        next_step = "Start with the highest-severity cited item, then inspect that pod and its correlated logs."
    else:
        next_step = "Ask a more focused follow-up using a pod name, an error message, or a metric such as memory, CPU, restarts, or forecast."
    assessment = _operations_assessment(evidence_snapshot, evidence, investigation_pod)
    if assessment.startswith("No correlated failure"):
        next_step = "No immediate corrective action is indicated. Monitor the cited workload and investigate only if a current error, restart, or alert appears."
    context_note = f" (strict scope: {', '.join(sorted(scoped_names))})" if scoped_names else (f" (focused on {investigation_pod})" if investigation_pod else "")
    answer = "\n".join([
        f"Short answer{context_note} for: “{clean_question}”",
        *(evidence_text or ["• No matching live records were found."]),
        f"Assessment: {assessment}",
        f"Next step: {next_step}",
    ])
    return {"answer": answer, "mode": "python-operations-intelligence", "generated_at": snapshot.get("generated_at"), "sources": ["Live workload telemetry", "Masked pod logs", "Alert rules and capacity forecast"], "scope": {"matched_pods": sorted(scoped_names), "strict": bool(scoped_names)}, "evidence": evidence, "actions": _assistant_actions(evidence, investigation_pod, normalized)}


class AlertEngine:
    """Persistent, local alert rules and their evaluated history."""

    def __init__(self) -> None:
        self.data_dir = Path(os.getenv("DATA_DIR", "/tmp/pulseops-data"))
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.rules_file = self.data_dir / "alert-rules.json"
        self.history_file = self.data_dir / "alert-history.json"
        self.breach_file = self.data_dir / "alert-breaches.json"
        self._lock = Lock()
        self._newly_raised: list[dict[str, Any]] = []
        if not self.rules_file.exists():
            self._write(self.rules_file, DEFAULT_ALERT_RULES)

    @staticmethod
    def _load(path: Path, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
        try:
            content = json.loads(path.read_text())
            return content if isinstance(content, list) else fallback
        except (OSError, json.JSONDecodeError):
            return fallback

    @staticmethod
    def _write(path: Path, content: list[dict[str, Any]]) -> None:
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(content, indent=2))
        temporary.replace(path)

    def rules(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._load(self.rules_file, DEFAULT_ALERT_RULES)

    def update_rule(self, rule_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        scope_type = str(changes.get("scope_type", "all")).strip().lower()
        scope_value = str(changes.get("scope_value", "")).strip()
        if scope_type not in {"all", "pod", "name_contains"}:
            raise ValueError("Choose All pods, a specific pod, or a name match.")
        if scope_type != "all" and not scope_value:
            raise ValueError("Enter a pod name or name match for this alert scope.")
        with self._lock:
            rules = self._load(self.rules_file, DEFAULT_ALERT_RULES)
            for rule in rules:
                if rule["id"] == rule_id:
                    rule.update({"enabled": bool(changes["enabled"]), "threshold": float(changes["threshold"]), "sustain_minutes": int(changes.get("sustain_minutes", 0)), "scope_type": scope_type, "scope_value": scope_value})
                    self._write(self.rules_file, rules)
                    return rule
        raise KeyError(rule_id)

    def create_pattern_rule(self, changes: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            rules = self._load(self.rules_file, DEFAULT_ALERT_RULES)
            pattern = str(changes["pattern"]).strip()
            rule = {
                "id": f"log-pattern-{uuid4().hex[:10]}",
                "name": str(changes["name"]).strip() or "Log pattern alert",
                "metric": "log_pattern",
                "pattern": pattern,
                "threshold": float(changes["threshold"]),
                "sustain_minutes": int(changes.get("sustain_minutes", 0)),
                "severity": changes.get("severity", "warning"),
                "enabled": True,
                "scope_type": "all",
                "scope_value": "",
                "description": f"Triggers when '{pattern}' appears repeatedly in the current log sample.",
            }
            rules.append(rule)
            self._write(self.rules_file, rules)
            return rule

    def create_rule(self, changes: dict[str, Any]) -> dict[str, Any]:
        scope_type = str(changes.get("scope_type", "all")).strip().lower()
        scope_value = str(changes.get("scope_value", "")).strip()
        if scope_type not in {"all", "pod", "name_contains"}:
            raise ValueError("Choose All pods, a specific pod, or a name match.")
        if scope_type != "all" and not scope_value:
            raise ValueError("Enter a pod name or name match for this alert scope.")
        metric = str(changes["metric"])
        unit = "%" if metric.endswith("_percent") else "restarts" if metric == "restarts" else "errors"
        metric_label = {"memory_percent": "Memory", "cpu_percent": "CPU", "restarts": "Restart", "errors": "Error"}[metric]
        with self._lock:
            rules = self._load(self.rules_file, DEFAULT_ALERT_RULES)
            rule = {
                "id": f"custom-{uuid4().hex[:10]}",
                "name": str(changes["name"]).strip(),
                "metric": metric,
                "threshold": float(changes["threshold"]),
                "severity": str(changes["severity"]),
                "enabled": True,
                "scope_type": scope_type,
                "scope_value": scope_value,
                "description": f"Custom {metric_label.lower()} alert at {float(changes['threshold']):g} {unit}.",
            }
            rules.append(rule)
            self._write(self.rules_file, rules)
            return rule

    def delete_rule(self, rule_id: str) -> None:
        """Only user-created rules may be removed; default guardrails can be disabled instead."""
        if not rule_id.startswith(("custom-", "log-pattern-")):
            raise ValueError("Built-in rules cannot be deleted. Disable them instead if they are not required.")
        with self._lock:
            rules = self._load(self.rules_file, DEFAULT_ALERT_RULES)
            updated = [rule for rule in rules if rule.get("id") != rule_id]
            if len(updated) == len(rules):
                raise KeyError(rule_id)
            self._write(self.rules_file, updated)

    def history(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._load(self.history_file, [])[-100:]

    def consume_newly_raised(self) -> list[dict[str, Any]]:
        """Return alerts that became active in the latest evaluation once only."""
        with self._lock:
            events, self._newly_raised = self._newly_raised, []
        return events

    @staticmethod
    def _value(rule: dict[str, Any], pod: dict[str, Any], analysis: dict[str, Any], snapshot: dict[str, Any]) -> float:
        metric = rule["metric"]
        if metric in {"memory_percent", "cpu_percent"}:
            return float(pod.get(metric, 0))
        if metric == "restarts":
            return float(sum(int(event.get("increase", 0)) for event in snapshot.get("restart_window", {}).get("changes", []) if event.get("pod") == pod.get("name")))
        if metric == "log_pattern":
            pattern = str(rule.get("pattern", "")).casefold()
            return float(sum(pattern in line.casefold() for line in snapshot.get("logs", {}).get(pod["name"], [])))
        return float(analysis.get("counts", {}).get(metric, 0))

    def evaluate(self, snapshot: dict[str, Any]) -> list[dict[str, Any]]:
        now = datetime.now(timezone.utc).isoformat()
        now_epoch = time.time()
        try:
            breaches = json.loads(self.breach_file.read_text())
            breaches = breaches if isinstance(breaches, dict) else {}
        except (OSError, json.JSONDecodeError):
            breaches = {}
        active: list[dict[str, Any]] = []
        newly_raised: list[dict[str, Any]] = []
        for rule in self.rules():
            if not rule.get("enabled"):
                continue
            for pod in snapshot["pods"]:
                scope_type = str(rule.get("scope_type", "all"))
                scope_value = str(rule.get("scope_value", "")).casefold()
                pod_name = str(pod.get("name", "")).casefold()
                if scope_type == "pod" and pod_name != scope_value:
                    continue
                if scope_type == "name_contains" and scope_value not in pod_name:
                    continue
                value = self._value(rule, pod, snapshot["analysis"].get(pod["name"], {}), snapshot)
                # Restart and error conditions are intentionally event-based:
                # a single occurrence is meaningful, unlike a percentage limit.
                threshold = 1.0 if rule["metric"] in {"restarts", "errors"} else float(rule["threshold"])
                breach_key = f"{rule['id']}:{pod['name']}"
                if value < threshold:
                    breaches.pop(breach_key, None)
                    continue
                sustain_seconds = max(0, int(rule.get("sustain_minutes", 0))) * 60 if rule["metric"] in {"memory_percent", "cpu_percent"} else 0
                first_breach = float(breaches.setdefault(breach_key, now_epoch))
                if now_epoch - first_breach < sustain_seconds:
                    continue
                active.append({
                    "id": f"rule:{rule['id']}:{pod['name']}", "source": "rule", "rule_id": rule["id"],
                    "pod": pod["name"], "severity": rule["severity"], "value": round(value, 1),
                    "threshold": threshold, "message": (f"{rule['name']}: a restart was detected in the last 10 minutes." if rule["metric"] == "restarts" else f"{rule['name']}: an error was detected in the current log sample." if rule["metric"] == "errors" else f"{rule['name']}: {value:g} exceeds the configured threshold of {threshold:g}."),
                    "timestamp": now,
                })
        with self._lock:
            history = self._load(self.history_file, [])
            by_id = {event["id"]: event for event in history}
            active_ids = {event["id"] for event in active}
            for event in active:
                previous = by_id.get(event["id"])
                if previous:
                    previous.update(event)
                    previous["last_seen"] = now
                    previous["occurrences"] = int(previous.get("occurrences", 1)) + 1
                    previous["state"] = "active"
                else:
                    raised = {**event, "first_seen": now, "last_seen": now, "occurrences": 1, "state": "active"}
                    history.append(raised)
                    newly_raised.append(raised)
            for event in history:
                if event.get("state") == "active" and event["id"] not in active_ids:
                    event["state"] = "resolved"
                    event["resolved_at"] = now
            self._write(self.history_file, history[-300:])
            temporary = self.breach_file.with_suffix(".tmp")
            temporary.write_text(json.dumps(breaches))
            temporary.replace(self.breach_file)
            self._newly_raised = newly_raised
        return active


class AlertNotifier:
    """Optional Microsoft Teams webhook delivery for newly raised alert rules.

    The webhook is deliberately supplied only through TEAMS_WEBHOOK_URL (normally a
    Kubernetes Secret). The UI can enable, disable, and test delivery but never
    reads or stores that secret.
    """

    def __init__(self) -> None:
        self.data_dir = Path(os.getenv("DATA_DIR", "/tmp/pulseops-data"))
        self.file = self.data_dir / "notification-settings.json"
        self._lock = Lock()
        self._last_delivery: str | None = None
        self._last_error: str | None = None

    def _load(self) -> dict[str, Any]:
        try:
            value = json.loads(self.file.read_text())
            return value if isinstance(value, dict) else {}
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return {}

    def _save(self, value: dict[str, Any]) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        temporary = self.file.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, indent=2))
        temporary.replace(self.file)

    @staticmethod
    def _valid_webhook(url: str) -> bool:
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname:
            return False
        allowed = [item.strip().lower() for item in os.getenv("NOTIFICATION_ALLOWED_HOSTS", "").split(",") if item.strip()]
        if not allowed:
            return False
        host = parsed.hostname.lower()
        return any(host == item or item.startswith("*.") and host.endswith(item[1:]) for item in allowed)

    def settings(self) -> dict[str, Any]:
        saved = self._load()
        webhook = os.getenv("TEAMS_WEBHOOK_URL", "").strip()
        return {"enabled": bool(saved.get("enabled", os.getenv("NOTIFICATIONS_ENABLED", "false").lower() == "true")), "provider": "Microsoft Teams", "webhook_configured": bool(webhook and self._valid_webhook(webhook)), "last_delivery": self._last_delivery, "last_error": self._last_error}

    def update(self, enabled: bool) -> dict[str, Any]:
        with self._lock:
            self._save({"enabled": bool(enabled)})
        return self.settings()

    def _send(self, title: str, lines: list[str]) -> None:
        webhook = os.getenv("TEAMS_WEBHOOK_URL", "").strip()
        if not self._valid_webhook(webhook):
            raise ValueError("Teams webhook is not configured or its host is not approved.")
        payload = {"@type": "MessageCard", "@context": "https://schema.org/extensions", "summary": title, "themeColor": "C62828", "title": title, "text": "<br>".join(lines)}
        response = requests.post(webhook, json=payload, timeout=8)
        if response.status_code >= 300:
            raise ValueError(f"Teams delivery failed with HTTP {response.status_code}.")

    def deliver(self, alerts: list[dict[str, Any]]) -> None:
        if not alerts or not self.settings()["enabled"]:
            return
        try:
            lines = [part for item in alerts for part in (f"<b>{item.get('severity', 'warning').upper()}</b> · {item.get('pod', 'workload')}", str(item.get('message', 'Alert raised')))]
            self._send("L1ControlScope: new alert", lines)
            self._last_delivery, self._last_error = datetime.now(timezone.utc).isoformat(), None
        except (requests.RequestException, ValueError) as error:
            self._last_error = str(error)

    def test(self) -> dict[str, Any]:
        self._send("L1ControlScope: test notification", ["This is a test. No workload alert was raised."])
        self._last_delivery, self._last_error = datetime.now(timezone.utc).isoformat(), None
        return self.settings()


class OperationalHistory:
    """Small, local, persistent history for dashboard trends and investigations."""

    def __init__(self, data_dir: Path) -> None:
        self.file = data_dir / "operational-history.json"
        self.samples: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.previous_pods: dict[str, dict[str, Any]] = {}
        self.previous_workloads: dict[str, dict[str, Any]] = {}
        self.seen_log_signatures: dict[str, float] = {}
        self._last_persist = 0.0
        try:
            saved = json.loads(self.file.read_text())
            self.samples = [item for item in saved.get("samples", []) if isinstance(item, dict)]
            self.events = [item for item in saved.get("events", []) if isinstance(item, dict)]
            self.previous_workloads = {str(name): state for name, state in saved.get("workload_states", {}).items() if isinstance(state, dict)}
            self.seen_log_signatures = {str(key): float(value) for key, value in saved.get("seen_log_signatures", {}).items()}
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            pass

    def _persist(self) -> None:
        try:
            self.file.write_text(json.dumps({"samples": self.samples, "events": self.events, "workload_states": self.previous_workloads, "seen_log_signatures": self.seen_log_signatures}))
            self._last_persist = time.time()
        except OSError:
            pass

    @staticmethod
    def _event(timestamp: float, kind: str, severity: str, title: str, pod: str | None = None, detail: str = "") -> dict[str, Any]:
        return {"id": str(uuid4()), "timestamp": timestamp, "kind": kind, "severity": severity, "title": title, "pod": pod, "detail": detail}

    def record(self, snapshot: dict[str, Any]) -> None:
        now = time.time()
        pods = snapshot.get("pods", [])
        analysis = snapshot.get("analysis", {})
        sample = {
            "timestamp": now,
            "summary": {
                "cpu": snapshot.get("summary", {}).get("average_cpu_percent", 0),
                "memory": snapshot.get("summary", {}).get("average_memory_percent", 0),
                "pods": snapshot.get("summary", {}).get("pods", 0),
                "running": snapshot.get("summary", {}).get("running_pods", 0),
                "alerts": snapshot.get("summary", {}).get("alerts", 0),
                "errors": sum(item.get("counts", {}).get("errors", 0) for item in analysis.values()),
                "warnings": sum(item.get("counts", {}).get("warnings", 0) for item in analysis.values()),
                "restarts": sum(int(pod.get("restarts", 0)) for pod in pods),
            },
            "pods": [{"name": pod["name"], "cpu": pod.get("cpu_percent", 0), "memory": pod.get("memory_percent", 0), "restarts": pod.get("restarts", 0), "risk": pod.get("risk", "healthy")} for pod in pods],
            "workloads": [
                {
                    "name": workload.get("name"), "image": workload.get("image", ""), "status": workload.get("status", "Unknown"),
                    "available": workload.get("available", 0), "desired": workload.get("desired", 0),
                    "cpu": workload.get("summary", {}).get("cpu_percent", 0), "memory": (
                        round(100 * workload.get("summary", {}).get("memory_mib", 0) / max(workload.get("summary", {}).get("memory_limit_mib", 0), 1), 1)
                    ), "restarts": workload.get("summary", {}).get("restarts", 0),
                    "errors": sum(resource.get("analysis", {}).get("counts", {}).get("errors", 0) for resource in workload.get("resources", [])),
                }
                for workload in snapshot.get("deployments", [])
                if workload.get("status") != "Completed"
            ],
        }
        self.samples.append(sample)
        current_pods: dict[str, dict[str, Any]] = {}
        for pod in pods:
            name = pod["name"]
            current = {"status": pod.get("status"), "restarts": int(pod.get("restarts", 0)), "risk": pod.get("risk", "healthy")}
            previous = self.previous_pods.get(name)
            if previous and previous["status"] != current["status"]:
                self.events.append(self._event(now, "runtime", "critical" if current["status"] != "Running" else "healthy", f"Runtime changed to {current['status']}", name, f"Previous state: {previous['status']}"))
            if previous and current["restarts"] > previous["restarts"]:
                self.events.append(self._event(now, "restart", "warning", f"Restart count increased by {current['restarts'] - previous['restarts']}", name, "Inspect the pod log context and recent deployment changes."))
            if previous and previous["risk"] != current["risk"]:
                self.events.append(self._event(now, "health", current["risk"], f"Health changed to {current['risk']}", name, "Derived from current runtime, capacity, and log signals."))
            current_pods[name] = current
        self.previous_pods = current_pods
        current_workloads: dict[str, dict[str, Any]] = {}
        for workload in snapshot.get("inventory", {}).get("workloads", []):
            name = str(workload.get("name", "workload"))
            state = {"available": workload.get("available", 0), "desired": workload.get("desired", 0), "status": workload.get("status", "Unknown"), "image": workload.get("image", "")}
            previous = self.previous_workloads.get(name)
            if previous:
                if previous.get("image") != state["image"]:
                    event = self._event(now, "deployment", "warning", "Deployment image changed", name, f"{previous.get('image') or 'Unknown image'} → {state['image'] or 'Unknown image'}")
                    event.update({"workload": name, "previous_image": previous.get("image", ""), "current_image": state["image"], "change_type": "image"})
                    self.events.append(event)
                if previous.get("status") != state["status"] or previous.get("available") != state["available"] or previous.get("desired") != state["desired"]:
                    severity = "warning" if state["status"] not in {"Ready", "Completed"} or state["available"] != state["desired"] else "healthy"
                    self.events.append(self._event(now, "deployment", severity, f"Deployment readiness changed: {state['status']}", name, f"Ready replicas: {previous.get('available', 0)}/{previous.get('desired', 0)} → {state['available']}/{state['desired']}"))
            else:
                event = self._event(now, "deployment", "healthy", "Release first observed", name, state["image"] or "Unknown image")
                event.update({"workload": name, "previous_image": "", "current_image": state["image"], "change_type": "observed"})
                self.events.append(event)
            current_workloads[name] = state
        self.previous_workloads = current_workloads
        for pod_name, records in snapshot.get("structured_logs", {}).items():
            for record in records:
                if record.get("level") not in {"critical", "error", "warn", "warning"}:
                    continue
                signature = f'{pod_name}|{record.get("timestamp")}|{record.get("raw")}'
                if signature in self.seen_log_signatures:
                    continue
                self.seen_log_signatures[signature] = now
                severity = "critical" if record.get("level") == "critical" else "warning"
                event = self._event(now, "log", severity, f'{record.get("level", "warning").title()} log detected', pod_name, str(record.get("message", ""))[:500])
                event["log_level"] = record.get("level")
                self.events.append(event)
        for alert in snapshot.get("alerts", []):
            signature = f"{alert.get('source', 'system')}:{alert.get('pod')}:{alert.get('message')}"
            recent = any(item.get("signature") == signature and now - float(item.get("timestamp", 0)) < 300 for item in self.events[-100:])
            if not recent:
                event = self._event(now, "alert", alert.get("severity", "warning"), "Alert raised", alert.get("pod"), alert.get("message", ""))
                event["signature"] = signature
                self.events.append(event)
        cutoff = now - 86400
        self.samples = [item for item in self.samples if float(item.get("timestamp", 0)) >= cutoff]
        self.events = [item for item in self.events if float(item.get("timestamp", 0)) >= cutoff][-500:]
        self.seen_log_signatures = dict(sorted(((key, value) for key, value in self.seen_log_signatures.items() if value >= cutoff), key=lambda item: item[1])[-3000:])
        if now - self._last_persist >= 60:
            self._persist()

    @staticmethod
    def _downsample(samples: list[dict[str, Any]], maximum: int = 180) -> list[dict[str, Any]]:
        if len(samples) <= maximum:
            return samples
        step = len(samples) / maximum
        return [samples[int(index * step)] for index in range(maximum)]

    def report(self, snapshot: dict[str, Any], minutes: int = 60) -> dict[str, Any]:
        now = time.time()
        cutoff = now - max(5, min(minutes, 1440)) * 60
        samples = self._downsample([item for item in self.samples if float(item.get("timestamp", 0)) >= cutoff])
        events = [item for item in self.events if float(item.get("timestamp", 0)) >= cutoff][-100:]
        pods = snapshot.get("pods", [])
        analysis = snapshot.get("analysis", {})
        forecasts = {item.get("pod"): item for item in snapshot.get("forecasts", [])}
        completed_tasks = set(snapshot.get("completed_tasks", []))
        active = [pod for pod in pods if pod.get("status") != "Succeeded" and not any(f"-{task}-" in pod.get("name", "") for task in completed_tasks)]
        running = [pod for pod in active if pod.get("status") == "Running"]
        error_pods = [pod for pod in active if analysis.get(pod["name"], {}).get("counts", {}).get("errors", 0)]
        availability = round(100 * len(running) / max(len(active), 1), 1)
        slo = {
            "availability_percent": availability,
            "target_percent": 99.5,
            "status": "healthy" if availability >= 99.5 and not error_pods else "warning" if availability >= 95 else "critical",
            "error_pods": len(error_pods),
            "restart_events": len([event for event in events if event.get("kind") == "restart"]),
            "note": "Telemetry health indicator based on current workload availability, restarts, and log errors; not a request-level application SLO.",
        }
        capacity = []
        for pod in active:
            forecast = forecasts.get(pod["name"], {})
            capacity.append({
                "pod": pod["name"], "cpu_percent": pod.get("cpu_percent", 0), "memory_percent": pod.get("memory_percent", 0),
                "forecast_percent": forecast.get("forecast_percent", pod.get("memory_percent", 0)),
                "risk": max(pod.get("risk", "healthy"), forecast.get("forecast_risk", "healthy"), key={"healthy": 0, "warning": 1, "critical": 2}.get),
            })
        capacity.sort(key=lambda item: max(item["cpu_percent"], item["memory_percent"], item["forecast_percent"]), reverse=True)
        nodes = []
        for pod in active:
            label = pod["name"]
            lowered = label.lower()
            kind = "Database" if any(token in lowered for token in ("postgres", "mysql", "mongo", "redis")) else "Frontend" if any(token in lowered for token in ("frontend", "web", "ui")) else "AI runtime" if "ollama" in lowered else "Backend" if any(token in lowered for token in ("backend", "api", "server")) else "Workload"
            nodes.append({"id": label, "label": label, "kind": kind, "status": pod.get("risk", "healthy")})
        ids_by_kind: dict[str, list[str]] = {}
        for node in nodes:
            ids_by_kind.setdefault(node["kind"], []).append(node["id"])
        edges = []
        for source in ids_by_kind.get("Frontend", []):
            for target in ids_by_kind.get("Backend", []):
                edges.append({"from": source, "to": target, "label": "HTTP/API"})
        for source in ids_by_kind.get("Backend", []):
            for target in ids_by_kind.get("Database", []):
                edges.append({"from": source, "to": target, "label": "data"})
            for target in ids_by_kind.get("AI runtime", []):
                edges.append({"from": source, "to": target, "label": "AI"})
        dependencies = [{"name": node["label"], "type": node["kind"], "status": node["status"], "detail": "Live workload telemetry"} for node in nodes]
        ordered_events = list(reversed(events))
        return {"range_minutes": minutes, "samples": samples, "events": ordered_events, "deployment_changes": [event for event in ordered_events if event.get("kind") == "deployment"], "slo": slo, "capacity": capacity, "service_map": {"nodes": nodes, "edges": edges}, "dependencies": dependencies}


class IncidentEvidence:
    """Keeps a rolling log window and preserves it when a pod becomes unstable."""

    window_seconds = 15 * 60

    def __init__(self, data_dir: Path) -> None:
        self.file = data_dir / "incident-evidence.json"
        self.archive_dir = data_dir / "incident-archive"
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        self.retention_seconds = max(1, int(os.getenv("INCIDENT_ACTIVE_RETENTION_DAYS", "7"))) * 24 * 60 * 60
        self.archive_retention_seconds = max(1, int(os.getenv("INCIDENT_ARCHIVE_RETENTION_DAYS", "30"))) * 24 * 60 * 60
        self.maximum_incidents = max(10, int(os.getenv("INCIDENT_MAX_SNAPSHOTS", "100")))
        self.buffers: dict[str, list[dict[str, Any]]] = {}
        self.incidents: list[dict[str, Any]] = []
        try:
            saved = json.loads(self.file.read_text())
            self.incidents = [item for item in saved if isinstance(item, dict)]
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            pass

    def _persist(self) -> None:
        temporary = self.file.with_suffix(".tmp")
        try:
            temporary.write_text(json.dumps(self.incidents, indent=2))
            temporary.replace(self.file)
        except OSError:
            pass

    def _archive(self, incidents: list[dict[str, Any]]) -> None:
        """Append expired evidence as compressed JSON lines; archive stays outside the live dashboard."""
        if not incidents:
            return
        archive_file = self.archive_dir / f"incident-evidence-{datetime.now(timezone.utc).strftime('%Y-%m')}.jsonl.gz"
        try:
            with gzip.open(archive_file, "at", encoding="utf-8") as handle:
                for incident in incidents:
                    handle.write(json.dumps(incident, separators=(",", ":")) + "\n")
        except OSError:
            # Retain live evidence if the archive cannot be written.
            self.incidents.extend(incidents)

    def _prune_and_archive(self, now: float) -> None:
        active_cutoff = now - self.retention_seconds
        ordered = sorted(self.incidents, key=lambda item: str(item.get("detected_at", "")))
        expired = [item for item in ordered if _incident_timestamp(item) < active_cutoff]
        retained = [item for item in ordered if _incident_timestamp(item) >= active_cutoff]
        if len(retained) > self.maximum_incidents:
            overflow = retained[:-self.maximum_incidents]
            expired.extend(overflow)
            retained = retained[-self.maximum_incidents:]
        self.incidents = retained
        self._archive(expired)
        archive_cutoff = now - self.archive_retention_seconds
        for archive_file in self.archive_dir.glob("*.jsonl.gz"):
            try:
                if archive_file.stat().st_mtime < archive_cutoff:
                    archive_file.unlink()
            except OSError:
                pass

    def record_logs(self, snapshot: dict[str, Any], now: float) -> None:
        """Merge masked log records into a bounded, per-pod pre-incident window."""
        for pod, records in snapshot.get("structured_logs", {}).items():
            existing = self.buffers.setdefault(pod, [])
            known = {f"{item.get('timestamp')}|{item.get('raw')}" for item in existing}
            for record in records:
                entry = {**record, "captured_at": now}
                signature = f"{entry.get('timestamp')}|{entry.get('raw')}"
                if signature not in known:
                    existing.append(entry)
                    known.add(signature)
            self.buffers[pod] = [item for item in existing if now - float(item.get("captured_at", now)) <= self.window_seconds]
        active = set(snapshot.get("structured_logs", {}))
        for pod in list(self.buffers):
            self.buffers[pod] = [item for item in self.buffers[pod] if now - float(item.get("captured_at", now)) <= self.window_seconds]
            if not self.buffers[pod] and pod not in active:
                self.buffers.pop(pod, None)

    def capture(self, pod: str, kind: str, detail: str, snapshot: dict[str, Any], now: float, severity: str = "warning") -> bool:
        """Persist the collected evidence immediately; the live buffer remains memory-only."""
        # A continuing error must not create a new snapshot every collection
        # cycle. Capture the first meaningful occurrence, then wait for the
        # rolling evidence window before storing the same trigger again.
        for existing in reversed(self.incidents):
            if existing.get("pod") == pod and existing.get("kind") == kind and existing.get("detail") == detail:
                if now - _incident_timestamp(existing) < self.window_seconds:
                    return False
        pod_state = next((item for item in snapshot.get("pods", []) if item.get("name") == pod), {})
        log_window = list(self.buffers.get(pod, []))[-2000:]
        deployment = next((item for item in snapshot.get("deployments", []) if any(resource.get("pod", {}).get("name") == pod for resource in item.get("resources", []))), {})
        active_alerts = [item for item in snapshot.get("alerts", []) if item.get("pod") == pod]
        incident = {
            "id": f"incident-{uuid4().hex[:12]}",
            "pod": pod,
            "kind": kind,
            "severity": severity,
            "detail": detail,
            "detected_at": datetime.fromtimestamp(now, timezone.utc).isoformat(),
            "window_minutes": 15,
            "window_start": datetime.fromtimestamp(now - self.window_seconds, timezone.utc).isoformat(),
            "pod_state": pod_state,
            "deployment": {key: deployment.get(key) for key in ("name", "image", "status", "available", "desired", "revision")},
            "active_alerts": [{key: alert.get(key) for key in ("severity", "message", "source")} for alert in active_alerts[:10]],
            "analysis": snapshot.get("analysis", {}).get(pod, {}),
            "log_window": log_window,
        }
        self.incidents.append(incident)
        self._prune_and_archive(now)
        self._persist()
        return True

    def summaries(self) -> list[dict[str, Any]]:
        return [
            {key: value for key, value in item.items() if key != "log_window"} | {"log_count": len(item.get("log_window", []))}
            for item in reversed(self.incidents[-25:])
        ]

    def get(self, incident_id: str) -> dict[str, Any] | None:
        return next((item for item in self.incidents if item.get("id") == incident_id), None)


def _incident_timestamp(incident: dict[str, Any]) -> float:
    try:
        return datetime.fromisoformat(str(incident.get("detected_at", ""))).timestamp()
    except ValueError:
        return 0.0


class TelemetryCollector:
    """Keeps live telemetry moving even when nobody has the dashboard open."""

    def __init__(self, client: ClusterClient, alerts: AlertEngine, notifier: AlertNotifier | None = None) -> None:
        self.client, self.alerts, self.notifier = client, alerts, notifier
        self.interval_seconds = max(2, int(os.getenv("COLLECT_INTERVAL_SECONDS", "5")))
        self._snapshot: dict[str, Any] | None = None
        self._error: str | None = None
        self._last_collected: str | None = None
        self._lock = Lock()
        self._stop = Event()
        self._thread: Thread | None = None
        self._started_at = time.time()
        self._restart_counts: dict[str, int] = {}
        self._pod_states: dict[str, str] = {}
        self._restart_events: list[dict[str, Any]] = []
        self._restart_history_file = self.alerts.data_dir / "restart-history.json"
        self.history = OperationalHistory(self.alerts.data_dir)
        self.incident_evidence = IncidentEvidence(self.alerts.data_dir)
        self._load_restart_history()

    def _load_restart_history(self) -> None:
        try:
            record = json.loads(self._restart_history_file.read_text())
            self._started_at = float(record.get("started_at", self._started_at))
            self._restart_counts = {str(name): int(value) for name, value in record.get("counts", {}).items()}
            self._restart_events = [event for event in record.get("events", []) if isinstance(event, dict)]
            self._pod_states = {str(name): str(value) for name, value in record.get("pod_states", {}).items()}
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            pass

    def _persist_restart_history(self) -> None:
        payload = {"started_at": self._started_at, "counts": self._restart_counts, "events": self._restart_events, "pod_states": self._pod_states}
        try:
            self._restart_history_file.write_text(json.dumps(payload))
        except OSError:
            pass

    def _record_restart_history(self, snapshot: dict[str, Any]) -> list[dict[str, Any]]:
        now = time.time()
        new_events: list[dict[str, Any]] = []
        for pod in snapshot.get("pods", []):
            name, current = pod["name"], int(pod.get("restarts", 0))
            previous = self._restart_counts.get(name)
            if previous is not None and current > previous:
                event = {"pod": name, "increase": current - previous, "timestamp": now}
                self._restart_events.append(event)
                new_events.append(event)
            self._restart_counts[name] = current
            state = f"{pod.get('status', 'Unknown')}:{pod.get('reason', '')}"
            previous_state = self._pod_states.get(name)
            status = str(pod.get("status", "Unknown"))
            if previous_state and previous_state != state and status not in {"Running", "Succeeded", "Observed"}:
                new_events.append({"pod": name, "kind": "eviction" if "evict" in state.casefold() else "runtime_failure", "previous_state": previous_state, "state": state, "timestamp": now})
            self._pod_states[name] = state
        self._restart_events = [event for event in self._restart_events if now - event["timestamp"] <= 600]
        self._persist_restart_history()
        snapshot["restart_window"] = {
            "observed_seconds": round(now - self._started_at),
            "changes": [{**event, "age_seconds": round(now - event["timestamp"])} for event in self._restart_events],
        }
        return new_events

    def _capture_incident_evidence(self, snapshot: dict[str, Any], events: list[dict[str, Any]]) -> None:
        now = time.time()
        self.incident_evidence.record_logs(snapshot, now)
        for event in events:
            if event.get("increase"):
                self.incident_evidence.capture(event["pod"], "restart", f"Restart count increased by {event['increase']}.", snapshot, now)
            elif event.get("kind") in {"runtime_failure", "eviction"}:
                label = "Eviction or termination" if event["kind"] == "eviction" else "Runtime failure"
                self.incident_evidence.capture(event["pod"], event["kind"], f"{label}: {event.get('previous_state', 'previous state')} → {event.get('state', 'current state')}", snapshot, now, "critical")
        # Preserve a single evidence package when the same masked error repeats.
        # This catches application failures even when the container does not restart.
        import re
        for pod, records in snapshot.get("structured_logs", {}).items():
            patterns: dict[str, dict[str, Any]] = {}
            for record in records:
                level = str(record.get("level", "")).casefold()
                if level not in {"error", "critical"}:
                    continue
                message = str(record.get("message") or record.get("raw") or "Error event")
                normalized = re.sub(r"\b[0-9a-f]{8,}\b|\d+", "#", message.casefold())[:220]
                current = patterns.setdefault(normalized, {"count": 0, "message": message[:220], "critical": False})
                current["count"] += 1
                current["critical"] = current["critical"] or level == "critical"
            for pattern in patterns.values():
                if pattern["count"] < 3 and not pattern["critical"]:
                    continue
                detail = f"Repeated application error: {pattern['count']} matching event(s). {pattern['message']}"
                self.incident_evidence.capture(pod, "repeated_error", detail, snapshot, now, "critical" if pattern["critical"] else "warning")
        snapshot["incident_evidence"] = self.incident_evidence.summaries()

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {"running": bool(self._thread and self._thread.is_alive()), "last_collected": self._last_collected, "error": self._error, "interval_seconds": self.interval_seconds}

    def collect_once(self) -> dict[str, Any]:
        try:
            snapshot = dashboard_snapshot(self.client)
            restart_events = self._record_restart_history(snapshot)
            rule_alerts = self.alerts.evaluate(snapshot)
            # Deliver each newly raised rule breach once. Active alerts remain
            # visible in the dashboard without producing notification noise.
            if self.notifier:
                self.notifier.deliver(self.alerts.consume_newly_raised())
            completed_tasks = set(snapshot.get("completed_tasks", []))
            rule_alerts = [alert for alert in rule_alerts if not any(f"-{name}-" in alert.get("pod", "") for name in completed_tasks)]
            system_alerts = [{**alert, "id": f"system:{alert['pod']}:{index}", "source": "system"} for index, alert in enumerate(snapshot["alerts"])]
            snapshot["alerts"] = [*system_alerts, *rule_alerts]
            snapshot["summary"]["alerts"] = len(snapshot["alerts"])
            # Capture after alert evaluation so every evidence package includes
            # the rule and system alerts that were active at detection time.
            self._capture_incident_evidence(snapshot, restart_events)
            self.history.record(snapshot)
            snapshot["observability"] = self.history.report(snapshot, minutes=60)
            snapshot["alert_rules"] = self.alerts.rules()
            snapshot["collector"] = {"interval_seconds": self.interval_seconds, "last_collected": snapshot["generated_at"], "error": None}
            with self._lock:
                self._snapshot, self._error, self._last_collected = snapshot, None, snapshot["generated_at"]
            return snapshot
        except ClusterConnectionError as error:
            with self._lock:
                self._error = str(error)
            raise

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.collect_once()
            except ClusterConnectionError:
                pass
            self._stop.wait(self.interval_seconds)

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = Thread(target=self._loop, name="pulseops-collector", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=self.interval_seconds + 1)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            snapshot, error = self._snapshot, self._error
        if snapshot is not None:
            return snapshot
        try:
            return self.collect_once()
        except ClusterConnectionError:
            raise ClusterConnectionError(error or "Live telemetry is unavailable.")

    def observability_report(self, minutes: int) -> dict[str, Any]:
        return self.history.report(self.snapshot(), minutes)
