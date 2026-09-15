# Elastic Watch integration

PulseOps presents ElasticWatch information in the **Elastic Watch** workspace.
ElasticWatch remains the service that connects to Elasticsearch. Filebeat or
Elastic Agent sends logs to Elasticsearch; PulseOps does not read Filebeat
files directly.

## Kubernetes / OpenShift in `gss-dev`

1. Deploy ElasticWatch in `gss-dev` with its Service named `elasticwatch`.
2. Configure ElasticWatch with a dedicated Elasticsearch account that has only
   cluster `monitor` and read access to the required Filebeat index or data
   stream.
3. Enable the `elasticWatch` block in the PulseOps values file:

```yaml
elasticWatch:
  enabled: true
  baseUrl: "http://elasticwatch.gss-dev.svc.cluster.local:8000"
  allowedHosts: "elasticwatch.gss-dev.svc.cluster.local"
  existingSecret: "elasticwatch-secrets"
  apiKeyKey: "DASHBOARD_API_KEY"
```

4. Upgrade PulseOps with the updated values file.

PulseOps reads only `DASHBOARD_API_KEY` from the referenced Secret and passes
it to ElasticWatch internally. Do not mount `ELASTICSEARCH_USERNAME` or
`ELASTICSEARCH_PASSWORD` into PulseOps.

## Local test

Start ElasticWatch on port `8091` with its real or test Elasticsearch
configuration. Then start PulseOps with:

```bash
ELASTICWATCH_ENABLED=true \
ELASTICWATCH_URL=http://host.docker.internal:8091 \
ELASTICWATCH_ALLOWED_HOSTS=host.docker.internal \
ELASTICWATCH_ALLOW_HTTP=true \
docker compose up -d --build
```

If ElasticWatch uses `DASHBOARD_API_KEY`, provide the same value as
`ELASTICWATCH_API_KEY` to PulseOps. The browser never receives this key.

## What users see

- **Overview:** Elasticsearch cluster state, nodes, capacity and Filebeat log summary.
- **Node fleet:** JVM heap, CPU, disk, and roles.
- **Indices & shards:** index health, document/store statistics, and shard placement.
- **Log explorer:** recent Filebeat-indexed evidence.
- **Alerts & incidents:** current ElasticWatch alerts and configured thresholds.

When the service is disconnected, the workspace says so clearly and does not
show generated or assumed Elasticsearch data.
