# Deploy PulseOps in `gss-dev`

This deployment keeps PulseOps and the resources it observes inside `gss-dev`.
The application receives **read-only** access only. It cannot change workloads,
delete resources, or read Secrets or ConfigMaps.

## Before deployment

1. Publish the PulseOps image to your approved container registry.
2. Update `image.repository` and `image.tag` in
   `helm/pulseops/values-gss-dev.example.yaml`.
3. If your cluster requires it, set the approved `persistence.storageClass`.
4. Keep ingress disabled until a hostname and TLS approach are approved.

## Install

```bash
helm lint helm/pulseops

helm upgrade --install pulseops ./helm/pulseops \
  --namespace gss-dev \
  --create-namespace \
  --values helm/pulseops/values-gss-dev.example.yaml
```

## Verify

```bash
kubectl -n gss-dev get deployment,pods,service,pvc

kubectl auth can-i \
  --as=system:serviceaccount:gss-dev:pulseops-gss-dev-reader \
  get pods/log -n gss-dev

kubectl auth can-i \
  --as=system:serviceaccount:gss-dev:pulseops-gss-dev-reader \
  get secrets -n gss-dev
```

The first permission should return `yes`; the Secrets check must return `no`.

## Information available to the app

Within `gss-dev`, PulseOps can read pod logs and events, workload and replica
status, Services and Endpoints, Ingress or OpenShift Routes, Jobs and CronJobs,
and resource quotas and limits. Metrics are displayed when the cluster metrics
API is installed and available.

The Role does not include write verbs, Secret access, ConfigMap access, or
cluster-wide permissions. Add any future access only when the matching screen
actually needs it.

## Optional Elastic Watch workspace

Deploy ElasticWatch as an internal `ClusterIP` service in `gss-dev`, then set
the `elasticWatch` block in the PulseOps values file to `enabled: true`.
PulseOps calls ElasticWatch's read-only API from the server side and displays
its cluster, node, index, shard, Filebeat-log, and alert information under the
**Elastic Watch** workspace.

Use the same Kubernetes Secret only to inject the `DASHBOARD_API_KEY` key into
PulseOps. The PulseOps deployment must not receive the Elasticsearch username,
password, or CA private material. See
[`docs/elasticwatch-integration.md`](elasticwatch-integration.md) for the
complete connection steps.
