# L1ControlScope: Simple Setup Guide

L1ControlScope is a read-only dashboard for checking application deployments, pods, CPU/memory usage, logs, alerts, and operational findings. It does not restart or modify workloads.

## 1. Run on your laptop

```bash
cd /Users/rajesh/Rajesh/repos/latest_code/ai-monitoring
cp .env.example .env
docker compose up --build -d
```

Open [http://localhost:8090](http://localhost:8090).

On the first visit, create a local account with an approved `@db.com` email and a password of at least 10 characters. Add initial administrator email addresses in your local `.env` file through `AUTH_BOOTSTRAP_ADMIN_EMAILS`. Those accounts display as **Administrator** after sign-in; all other approved-domain accounts display as **User**. Administrators can change alert rules, data sources, and AI runtime settings; users can view operational data but cannot change those controls.

Useful commands:

```bash
docker compose ps
docker compose down
docker compose up --build -d pulseops-ai
```

## 2. Choose how PulseOps gets data

Choose one simple model:

| Option | When to use it |
| --- | --- |
| Kubernetes / OpenShift | Your platform team allows read-only access to the application namespace. PulseOps can see live deployments, pods, resources, and logs. |
| Splunk | Your organisation already sends application logs to Splunk, or platform access is not permitted. Configure Splunk in the dashboard under **Data Sources**. |
| Prometheus | Use it when available for time-series metrics and memory forecasts. Configure it under **Data Sources**. |

For Splunk, provide the endpoint, index, application scope field, application scope value, and time window. Keep the Splunk token in a Kubernetes Secret or approved secret manager—not in the UI or Git.

## 3. Deploy to Kubernetes or OpenShift

The Helm chart is in `helm/pulseops`.

First, edit one configuration file:

```text
helm/pulseops/values.yaml
```

Set only the values you need:

- `image.repository` and `image.tag`
- `monitoring.target`: `kubernetes` or `splunk`
- Splunk endpoint/index/scope when using Splunk
- PVC size, if required
- OIDC non-secret values later, if required

Validate and deploy:

```bash
helm lint helm/pulseops
helm upgrade --install pulseops helm/pulseops \
  --namespace observability \
  --create-namespace
```

Run the same `helm upgrade --install` command after changing `values.yaml`. Helm will install on the first run and upgrade on later runs.

Check status:

```bash
kubectl -n observability get pods,svc,pvc
kubectl -n observability rollout status deployment/pulseops
```

## 4. Kubernetes permissions

For live Kubernetes/OpenShift monitoring, apply the included read-only namespace permissions after reviewing the namespace:

```bash
kubectl apply -f k8s/pulseops-rbac.yaml
```

If this is not permitted, use Splunk as the data source. Splunk can provide logs and observed workload names without cluster-wide permissions.

## 5. Storage

Enable the Helm PVC to retain PulseOps settings and alert rules across restarts.

- Local testing: `1Gi`
- Typical production deployment: `5Gi`

This PVC does not store all application logs. Splunk or your organisation's central log platform remains responsible for log retention.

## 6. OIDC: keep it simple

OIDC configuration is stored in two places:

| Item | Location |
| --- | --- |
| Issuer URL, client ID, redirect URL, allowed domain, administrator emails | `helm/pulseops/values.yaml` under `auth` |
| OIDC client secret only | Kubernetes Secret, using [the template](../k8s/pulseops-auth-secret.example.yaml) |

Use [the OIDC values example](../helm/pulseops/values-oidc.example.yaml) as a reference. Do not put the client secret in `values.yaml`.

Local sign-in and local administrator/user controls are implemented. OIDC login is not implemented yet; its configuration prepares the deployment only. Keep the dashboard available only to trusted internal users until enterprise OIDC is completed.

### Optional break-glass administrator

An emergency local administrator can use the username `admin` without an email address. It is disabled by default and works whether or not OIDC is configured in the future. Enable it only through a protected environment variable or Kubernetes Secret:

```text
AUTH_ENABLE_BREAK_GLASS_ADMIN=true
AUTH_BREAK_GLASS_USERNAME=admin
AUTH_BREAK_GLASS_PASSWORD=<12-or-more-character-secret>
```

Never use `admin/admin` or commit this password to Git. Use a unique password with at least 12 characters.

## 7. Optional AI

PulseOps includes built-in operations intelligence without an external model. Ollama is optional and runs separately. Configure it from the **Intelligence** page only after your security and AI-governance approvals are complete.

## Quick troubleshooting

| Problem | Check |
| --- | --- |
| No pods appear | Confirm namespace, service account, RBAC, and `monitoring.target`. |
| No logs | Confirm Kubernetes `pods/log` permission or Splunk scope and token permission. |
| Splunk connection fails | Check endpoint, TLS certificate, index access, token, and allowed host configuration. |
| Settings disappear after restart | Enable the PVC. |
| Dashboard has no login | Expected for now; do not expose it publicly. |
