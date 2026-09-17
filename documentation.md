# L1ControlScope – Product Overview

## What is L1ControlScope?

L1ControlScope is a read-only operations and observability application for Docker, Kubernetes, and OpenShift environments. It helps teams understand the health of applications, workloads, pods, logs, deployments, and monitored URLs from one place.

The purpose is simple: help a user move quickly from **"something looks wrong"** to **"this is the workload, evidence, and next check"** without needing to search through several tools first.

It does not deploy, restart, scale, modify, or delete application workloads.

## Who uses it?

| Consumer | Typical use |
| --- | --- |
| Developers | Check a deployment, pod readiness, image version, recent logs, errors, resource use, and release impact. |
| L1 / operations teams | Identify alerts, degraded workloads, restarts, log patterns, URL failures, and the most useful next investigation step. |
| Engineering managers | Review service availability evidence, deployment activity, incident outcomes, and operational risk at a high level. |
| Administrators | Manage user access, data-source settings, URL monitoring, alert rules, and audit history. |

The application has three access levels:

- **Administrator** – configuration, user access, alert rules, URL monitoring, and audit history.
- **Developer / Operator** – live telemetry, logs, workload investigation, alerts, and intelligence.
- **Read-only** – safe visibility of operational status and alerts without configuration or log-level access.

## What can users do?

### Command Center

- See the current health of monitored workloads.
- Identify alerts, memory/CPU risk, restart activity, and recent operational changes.
- Open the most relevant workload, alert, logs, or investigation view from summary cards.
- Review a verified resource topology.

### Workloads and pods

- List Deployments and StatefulSets with desired/available replicas, image version, deployment time, and health.
- Inspect workload configuration such as linked Services, containers, resource requests/limits, service account, labels, ConfigMap references, Secret references, and PVC references.
- View pod status, node, restarts, CPU, memory, runtime events, and current log signals.
- Open a pod directly for detailed investigation and logs.

### Service topology and endpoints

For Kubernetes/OpenShift, L1ControlScope builds only verified relationships:

`Route / Ingress URL → Kubernetes Service → Deployment or StatefulSet → Pod investigation`

- Uses stable Service and workload names rather than changing pod names.
- Shows internal services when no Route or Ingress is associated.
- Shows Route/Ingress endpoints when the cluster exposes them.
- Allows an administrator to review a discovered endpoint and add it to URL Monitoring; endpoints are never added automatically.
- Does not guess application-to-application call paths. Distributed tracing is required to prove those relationships.

For local Docker, the same area is a simple runtime-service inventory rather than an artificial Kubernetes-style topology.

### Pod Logs and evidence

- Read recent pod logs and direct live-tail lines from the selected pod.
- Filter by pod, severity, time range, text, and structured fields.
- Review contextual log records before and after an event.
- Group repeated error signatures and create alert rules from them.
- Export filtered log data as JSON or CSV.
- Redact common sensitive values such as passwords, tokens, API keys, secrets, and Authorization headers before display or export.
- Preserve incident evidence when repeated errors, restarts, failures, or evictions are observed.

### Alerts and investigations

- Configure and evaluate alert rules for memory, CPU, restarts, and log errors.
- Review active alerts, alert history, recovery status, and recurring patterns.
- Open a guided investigation for the affected pod or workload.
- Use the Intelligence view to correlate live workload state, logs, alerts, deployment changes, and resource risk.

### URL Monitoring and Service Health

- Monitor approved application endpoints across Dev, QA, UAT, and Production.
- Record expected HTTP status, latest state, response time, and availability evidence.
- Review endpoint response history, environment comparison, service availability, evidence coverage, release activity, and incident outcomes.
- Use summary cards to open the relevant URL, workload, or alert evidence.

### Predictive capacity

- Show current pod memory use against its configured memory limit.
- Retain up to 24 hours of Prometheus memory history, sampled every five minutes.
- Calculate one-hour and four-hour memory projections using a robust trend calculation that reduces the influence of short spikes.
- Show how much retained history is available. A forecast is not shown as a prediction until at least one hour of history exists.
- Exclude samples older than the observed pod instance where possible, so a rollout does not mix old and new pod history.

This is an operational early-warning signal, not a contractual capacity guarantee or a long-term demand forecast.

## How does L1ControlScope get data?

```text
Kubernetes / OpenShift API ─┐
Metrics Server              ├─> L1ControlScope collector ─> Dashboard and API
Prometheus                  ┤
Kubernetes pod logs         ┤
Optional Splunk fallback ───┘
```

### Primary sources

| Source | Information collected |
| --- | --- |
| Kubernetes / OpenShift API | Pods, Services, Deployments, StatefulSets, Jobs, events, Routes, Ingresses, PVC metadata, resource configuration, and readiness. |
| Kubernetes Metrics API | Current pod CPU and memory usage when Metrics Server is available. |
| Kubernetes pod logs | Recent application logs and direct live-tail log lines. |
| Prometheus | Retained CPU/memory time series and memory-capacity forecasting. |
| URL checks | Availability, response status, and response time for approved endpoints. |
| Splunk, optional | Log fallback when direct `pods/log` access is unavailable, or a Splunk-only external monitoring mode. |
| Docker, local mode | Container status, resource use, restart counts, ports, and logs through the local Docker socket. |

### Background collection

The collector refreshes current telemetry at the configured interval (five seconds by default). It continues collecting even when no user has the dashboard open.

Operational history, alert history, account data, audit events, URL-monitor configuration, and incident evidence are stored in the application data volume. Raw Prometheus metrics are stored by Prometheus, not copied into the application PVC.

## Kubernetes and OpenShift deployment model

L1ControlScope is deployed using the included Helm chart.

- The chart creates a Deployment, ServiceAccount, namespace-scoped read-only Role and RoleBinding, Service, and PVC.
- The default Service is `ClusterIP`; expose only the dashboard through an approved Ingress or Route.
- The Role allows read-only access to required resources, including Pods, Services, Deployments, StatefulSets, events, pod logs, Ingresses, OpenShift Routes, and pod metrics.
- It deliberately cannot edit workloads, read Secrets, open pod terminals, or use privileged access.
- The app can be installed in one namespace and monitor another permitted namespace through `monitoring.namespace`.
- A PVC is used for persistent application state. The default size is **1 Gi**.
- Keep one application replica while state is stored on a single ReadWriteOnce PVC. Use shared storage or a database before enabling multiple replicas.

## Security and privacy principles

- Read-only cluster access by default.
- No workload actions from the dashboard.
- Secrets and ConfigMap values are not displayed.
- Common credentials are masked from logs and exports.
- Tokens, passwords, OIDC client secrets, and session secrets belong in Kubernetes Secrets—not Helm values or the UI.
- Local Docker socket access is for laptop-only Docker monitoring and must not be mounted in a shared Kubernetes/OpenShift deployment.
- Optional AI is not required for monitoring. The built-in intelligence uses deterministic, evidence-based rules. A separately approved local AI runtime can be enabled later if required.

## Important boundaries and expectations

- Workload, Service, Route, and Ingress data appears only when the monitoring ServiceAccount has the required read permissions.
- CPU and memory usage require Metrics Server or an approved metrics source.
- Memory forecasting requires Prometheus history; the UI clearly shows when history is still collecting.
- URL monitoring is based on explicitly approved endpoints. A discovered cluster Route is presented for administrator review, not automatically monitored.
- Pod names change during redeployments. Use Service and Deployment/StatefulSet names for stable operational navigation.
- A healthy dashboard process does not guarantee all data sources are available. The connection status and error details explain when live telemetry is degraded.

## Quick user journey

1. Open **Command Center** to see the highest-priority operational signal.
2. Open **Workloads** to select a stable Deployment or StatefulSet.
3. Review replicas, image, linked Service, Route/Ingress, resource configuration, and recent deployment changes.
4. Open the related pod only when runtime events, logs, or detailed evidence are needed.
5. Use **Alerts**, **Intelligence**, or **URL Monitoring** for the supporting evidence.

## Useful links in this repository

- [Operations Guide](docs/OPERATIONS_GUIDE.md)
- [Helm chart](helm/pulseops)
- [Kubernetes read-only RBAC example](k8s/pulseops-rbac.yaml)
- [GSS Dev deployment notes](docs/deploy-gss-dev.md)
