# Backend deployment notes

The backend now includes:
- structured request logging
- request IDs and propagation headers
- per-request timeouts and retries
- rate limiting
- health, readiness, and liveness endpoints
- basic Prometheus-style metrics at /metrics
- graceful shutdown handling

## Run locally

```bash
cp .env.example .env
docker compose up --build
```

## Key endpoints

- Gateway health: http://localhost:3000/health
- Orchestrator health: http://localhost:3001/health
- Metrics: http://localhost:3000/metrics
