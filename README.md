# L1ControlScope

Python-based observability dashboard for local Docker, Kubernetes, and OpenShift. It provides workload health, CPU and memory utilisation, restart counts, log pattern analysis, configurable alert rules, alert history, and a safe path to resource forecasting.

L1ControlScope includes local password sign-in for approved-domain users. Configure initial administrator email addresses with `AUTH_BOOTSTRAP_ADMIN_EMAILS`; the signed-in name and role appear in the dashboard header.

## Complete operations guide

For local use, data-source configuration, Helm deployment, RBAC, storage, Splunk, Prometheus, Ollama, secrets, and the current authentication roadmap, see the [PulseOps Operations Guide](docs/OPERATIONS_GUIDE.md).

For Helm-based OIDC setup, start from the non-secret [OIDC values template](helm/pulseops/values-oidc.example.yaml) and keep only the client secret in a Kubernetes Secret.


## Run locally

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:8090`.

The default configuration monitors the live local MindSpark Docker containers whose names start with `mindspark-`. It reads their actual status, CPU, memory, restart count, and recent logs; no dummy telemetry is used.

The local dashboard is available at `http://localhost:8090`. The completed `mindspark-migrate-1` container may appear as **Exited**. That is normal after database migration; it is shown so the dashboard reports the real state of every MindSpark container.

Prometheus is started automatically at `http://localhost:9090`. It stores local MindSpark CPU and memory readings every five seconds for seven days. A background collector refreshes Docker/Kubernetes telemetry every five seconds even when no browser is open, so Prometheus and forecasts continue to receive current readings. PulseOps uses that real history to calculate the 15-minute memory forecast after the first three readings (normally about 15 seconds).

## Python Operations Intelligence

PulseOps includes an internal, explainable Operations Intelligence engine. It expands approved operations vocabulary (for example, `database` also searches PostgreSQL and connection evidence), correlates live logs, restart counts, workload readiness, alerts, and capacity signals, then produces concise evidence-based assessments. It uses only Python code and current masked application data—no external AI service, downloaded model, or opaque model file is required.

Team aliases can be maintained in `config/operations-vocabulary.json`. Add your approved service terms there, for example `"gsscore": ["payment-backend", "gsscore-api"]`, then rebuild the container. The assistant also includes deterministic service playbooks (`Run database playbook`) and a current incident timeline (`Show incident timeline`).

## Optional: local Ollama runtime on macOS

PulseOps remains Python-only by default. If an approved future feature needs a local Ollama model, an **optional and separate** Docker setup is available. It does not alter the dashboard or download a model automatically.

Docker Desktop on macOS runs Linux containers, therefore the separate runtime uses the Linux Ollama container image; a macOS `.dmg` or macOS binary must not be copied into this container.

```bash
docker compose -f docker-compose.yml -f docker-compose.ollama.yml up --build -d
docker compose -f docker-compose.yml -f docker-compose.ollama.yml exec ollama ollama pull llama3.2:3b
```

The Ollama API is then available only on the local computer at `http://localhost:11434`. The model is retained in the `ollama-data` Docker volume. The image/runtime download is roughly 1.3–1.4 GB; a small model requires additional disk space and memory. Do not enable it in a bank or production environment until model approval, data classification, network-egress policy, image scanning, and resource limits have been agreed.

In PulseOps, click **Ask PulseOps** and then **AI runtime**. You can enter the local Ollama address, the reviewed model name, and enable or disable grounded local Ollama responses whenever required. **Test connection** sends only a health request to Ollama; it never sends pod telemetry or logs. Settings are stored in the PulseOps `/data` volume and therefore survive a local container restart.

When the setting is enabled, the chat uses a controlled two-step flow: PulseOps first generates its deterministic, evidence-based answer from live telemetry and masked logs; only that verified answer is sent to the local Ollama service for concise wording. If Ollama is stopped, unreachable, or has no selected model, PulseOps automatically keeps using Python intelligence and labels the fallback in the chat.

For a later Linux/RHEL or Kubernetes/OpenShift deployment, use the same separate runtime design but pin a reviewed Ollama image version, use a persistent volume for `/root/.ollama`, apply CPU/memory limits, and configure GPU resources only where approved. We will add the application integration only after the runtime and model are approved.

## Alert rules and history

The dashboard includes editable rules for CPU, memory, restart count, and error spikes. Rules are evaluated by the background collector and are saved to the `pulseops-data` Docker volume, along with a local alert history. This means rules survive dashboard and container restarts.

Notifications are intentionally not configured by default. After selecting an approved destination, the same alert engine can be extended with email, Microsoft Teams, or Slack delivery without changing the rules themselves.

## Operations command centre

The dashboard keeps a compact local operational history for up to 24 hours in the PulseOps data volume. It adds the following live, read-only views:

- CPU, memory, and log-error trends for 15 minutes, 1 hour, 6 hours, or 24 hours.
- A transparent telemetry-health indicator based on running workload availability, restart events, and current log errors. It is not a request-level application SLO.
- Capacity ranking using current CPU, memory, and the existing 15-minute memory forecast.
- Inferred frontend → backend → database / AI-runtime service relationships, based on monitored workload names.
- A timeline of restart, runtime-health, deployment-state, and alert transitions.
- Workload image/version visibility and deployment readiness, including locally saved workload views for fast filtering in larger environments.
- Pod-level correlation of alerts, events, logs, restarts, and capacity data.
- Saved local incident workspaces, plus JSON export and print-friendly incident reports.

The dashboard enforces three access levels: **Administrator**, **Developer / Operator**, and **Read-only**. Read-only users can review workload status and alerts but cannot view log-level evidence, change settings, or create/change alert rules. OIDC authorization-code sign-in is ready to enable when company SSO details are available.

## Local Docker monitoring

Docker Desktop must be running. The Compose configuration grants this local-only dashboard read access to the Docker socket in order to collect real container metrics and logs. Do not use this socket mount in a shared or public deployment.

Prometheus does not have Docker socket access. It receives only the metrics that PulseOps exposes, so it cannot control or inspect your local containers directly.

```env
MONITORING_TARGET=docker
MONITORING_CONTAINER_PREFIX=mindspark-
COLLECT_INTERVAL_SECONDS=5
```

## Later: connect to Kubernetes or OpenShift

Set the following in a trusted environment with Kubernetes API and Metrics Server access:

```env
MONITORING_TARGET=kubernetes
KUBECONFIG_PATH=/absolute/path/to/kubeconfig
KUBERNETES_NAMESPACE=mindspark-official
```

When deployed inside Kubernetes, the application first tries in-cluster credentials. On a developer computer it falls back to the active kubeconfig context.

Apply the included namespace-scoped permissions after changing every `mindspark-official` value in [`k8s/pulseops-rbac.yaml`](k8s/pulseops-rbac.yaml) to the namespace PulseOps will monitor:

```bash
kubectl apply -f k8s/pulseops-rbac.yaml
```

Configure the PulseOps Deployment with `serviceAccountName: pulseops`. This Role is deliberately read-only: it can inspect Pods, Services, Deployments, StatefulSets, Pod Metrics, and Pod logs, but cannot change workloads, read Secrets, or open pod terminals. CPU and memory usage is available when Metrics Server (`metrics.k8s.io`) is installed.

For several namespaces, apply one copy of this Role and RoleBinding in each namespace that PulseOps is permitted to inspect. A cluster-wide role is not needed for the current single-namespace configuration.

## Authentication configuration

L1ControlScope supports local sign-in with three roles: **Administrator** (configuration, alerts, users, and audit history), **Developer / Operator** (telemetry, logs, and intelligence), and **Read-only** (safe operational visibility). Bootstrap administrator emails are supplied through `AUTH_BOOTSTRAP_ADMIN_EMAILS` as a comma-separated deployment value; do not commit employee email lists or credentials to source control. Only administrators can change settings or alert rules.

Local accounts lock for **30 minutes** after five failed sign-in attempts by default. An administrator can unlock an account in **Access → Users and roles**. Change these defaults only when required using `AUTH_MAX_LOGIN_ATTEMPTS` and `AUTH_LOCKOUT_MINUTES`. Access changes, alert-rule changes, and data-source/AI setting changes are recorded in **Audit history**; passwords, tokens, and client secrets are never recorded.

An optional break-glass administrator uses the username `admin` without an email address. It is disabled by default. Enable it only through `AUTH_ENABLE_BREAK_GLASS_ADMIN=true` and supply a 12+ character `AUTH_BREAK_GLASS_PASSWORD` through an approved Secret. Do not use `admin/admin`.

OIDC authorization-code sign-in is already included. Local sign-in continues to work until the OIDC configuration is complete. When the issuer URL, client ID, redirect URL, and client secret are all present, the login screen shows **Sign in with company SSO**. The verified OIDC email creates or refreshes the same local access record; configured bootstrap emails become administrators and every other approved-domain user starts as Developer / Operator.

Helm creates and preserves a random session-signing Secret automatically when `auth.existingSecret` is empty. For OIDC, have the platform team create an approved Secret containing the OIDC client secret and session secret, then set `auth.existingSecret` to that Secret name. Secrets are never placed in `values.yaml` or shown in the UI.

## Helm deployment

The Helm chart at [`helm/pulseops`](helm/pulseops) creates the PulseOps Deployment, ServiceAccount, namespace-scoped read-only Role and RoleBinding, Service, and a PVC for saved users, encrypted password hashes, sessions, account-lock state, audit history, alerts, workspaces, and non-secret runtime settings. Ingress is optional. Autoscaling remains disabled while this state is on the single PVC; move state to a shared database before scaling the dashboard to multiple replicas.

Build and publish the container image first, then install the chart into the namespace PulseOps should monitor:

```bash
helm upgrade --install pulseops ./helm/pulseops \
  --namespace mindspark-official \
  --create-namespace \
  --set image.repository=registry.example.com/observability/pulseops-ai \
  --set image.tag=1.1.0
```

By default, the chart monitors the same namespace where it is installed. To run PulseOps in one namespace while monitoring another, set `monitoring.namespace`; the chart creates the Role and RoleBinding in that monitored namespace while keeping the ServiceAccount in the release namespace:

```bash
helm upgrade --install pulseops ./helm/pulseops \
  --namespace observability \
  --create-namespace \
  --set image.repository=registry.example.com/observability/pulseops-ai \
  --set image.tag=1.1.0 \
  --set monitoring.namespace=mindspark-official
```

Set `persistence.storageClass` when your cluster does not provide a default StorageClass. The default **1 Gi** PVC is sufficient for normal account/configuration/audit state because PulseOps does not persist raw pod logs or Prometheus data there. Set `persistence.enabled=false` only for short-lived testing, as users, sessions, audit history, alert rules, and local settings will be lost on pod replacement. For OpenShift, deploy with the chart defaults first; do not add a privileged security context or host Docker socket.

### Optional Splunk log fallback

Kubernetes pod logs remain the primary source. Splunk is used only when reading `pods/log` fails—for example, when the monitoring identity has no pod-log permission. It does **not** replace the Kubernetes permissions required to collect pod, deployment, service, and metrics data. The application Service defaults to `ClusterIP`; keep `/health`, `/ready`, and `/metrics` internal, and expose only the dashboard through an approved ingress or route.

In **Intelligence → Integrations**, enable **Splunk log fallback** and enter the approved Splunk management URL, index, pod-name field, and search window. PulseOps stores those non-secret settings in `/data`; it never displays or saves the Splunk token in the UI or PVC.

An administrator must inject the token and approved hostname through the deployment environment. For Helm, create a Secret and reference it in your values:

```bash
kubectl -n mindspark-official create secret generic pulseops-splunk \
  --from-literal=token='replace-with-a-token-from-your-secret-manager'

helm upgrade --install pulseops ./helm/pulseops \
  --namespace mindspark-official \
  --set splunk.enabled=true \
  --set splunk.baseUrl=https://splunk.company.example:8089 \
  --set splunk.allowedHosts=splunk.company.example \
  --set splunk.existingSecret=pulseops-splunk
```

The Splunk token needs permission only to run the restricted search used by PulseOps. Keep `SPLUNK_VERIFY_TLS=true` in production. The connection test checks the approved Splunk management API only; it does not send telemetry or run a log search.

### Splunk-only external monitoring (no Kubernetes RBAC)

When the platform team does not permit PulseOps to use Kubernetes API permissions, set `monitoring.target=splunk` and `rbac.create=false`. PulseOps then discovers recently observed pod names from the configured Splunk index and retrieves matching logs through Splunk. The dashboard labels this mode as **Splunk external source** and shows workload state as **Observed**, rather than claiming that a pod is currently running.

```bash
helm upgrade --install pulseops ./helm/pulseops \
  --namespace observability \
  --create-namespace \
  --set image.repository=registry.example.com/observability/pulseops-ai \
  --set image.tag=1.1.0 \
  --set monitoring.target=splunk \
  --set rbac.create=false \
  --set splunk.enabled=true \
  --set splunk.baseUrl=https://splunk.company.example:8089 \
  --set splunk.index=platform-kubernetes \
  --set splunk.podField=kubernetes.pod_name \
  --set splunk.allowedHosts=splunk.company.example \
  --set splunk.existingSecret=pulseops-splunk
```

This mode needs logs in Splunk with an indexed pod-name field (the default is `kubernetes.pod_name`). It can provide workload discovery, log search, error analysis, and log-based alerts without Kubernetes RBAC. CPU, memory, restarts, deployments, Services, and resource limits require those fields to be indexed in Splunk or connected through a separately approved metrics source; PulseOps does not fabricate them.

## API

The overview includes workload-delivery information in addition to individual
pod/container telemetry: ready deployments (or Docker Compose services), running
pods, exposed services, restart totals, and node count. Kubernetes deployment,
StatefulSet, and Service inventory is best-effort: if the monitoring identity has
only pod read permissions, the dashboard continues to work and shows the available
pod-level information.

Container logs are normalized into JSON records. The dashboard's **Centralised Log Explorer** lets
you select an event and view it with the five entries before it, so the immediate
context is visible without leaving PulseOps. Original text is retained in each
record's `raw` field.

The Centralised Log Explorer provides live-tail control, pod, severity, time-range,
and text filters; saved browser queries; JSON/CSV exports; adjustable preceding and
following context; and repeated-error grouping. Common password, token, API-key,
secret, and Authorization values are redacted before logs are displayed or exported.
Repeated error patterns can be saved as persistent alert rules from the UI.

- `GET /api/pods/{pod_name}/logs?limit=25` returns the most recent JSON records.
- `GET /api/pods/{pod_name}/logs?index=42&before=5` returns a selected record and
  its preceding context.
- `POST /api/alert-rules/log-pattern` creates a persistent alert rule for a repeated
  log pattern.

- `GET /health` – process liveness check
- `GET /ready` – application-readiness check; returns telemetry status in its JSON body while keeping the dashboard reachable when collection is degraded
- `GET /api/overview` – summary, pod metrics, alerts, logs, and forecasts
- `GET /api/pods/{pod_name}/forecast` – forecast for one pod

## Important note

The dashboard does not fabricate forecasts. Connect a time-series source such as Prometheus before enabling predictive resource forecasting.
