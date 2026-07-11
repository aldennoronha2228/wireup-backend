# Current Implementation Status

## Overview
This repository currently contains a monorepo layout with shared packages and service skeletons for all required backend services. Each service exposes REST endpoints and health checks and uses shared Zod schemas for request validation.

## Workspace Layout

```
packages/
  types/     # Shared TypeScript types
  schemas/   # Zod schemas for all contracts
  utils/     # Service client + error helpers
services/
  gateway/
  orchestrator/
  rag/
  planner/
  generator/
  validator/
  simulator/
  storage/
```

## Implemented Packages

### `packages/types`
- Full type definitions for:
  - Projects, sessions, storage payloads
  - RAG, Planner, Generator, Validator, Simulator contracts
  - Streaming events and API envelope types

### `packages/schemas`
- Zod schemas mirroring the types, including:
  - Request/response schemas for each service
  - Storage create/update/session request schemas
  - Streaming event schemas

### `packages/utils`
- `ServiceClient` for internal service-to-service calls
- Standardized error types (`WireUpError`, `ValidationError`, etc.)

## Implemented Services (API Skeletons)

### Gateway (`services/gateway`)
- `POST /api/chat` (SSE)
  - Validates `GatewayRequest`
  - Proxies streaming results from Orchestrator
- `GET /health`

### Orchestrator (`services/orchestrator`)
- `POST /api/orchestrate` (SSE)
  - Orchestrates the pipeline:
    1. RAG
    2. Planner
    3. Generator
    4. Validator
    5. Simulator
    6. Storage updates
  - Emits `StreamEvent` SSE messages
- `GET /health`

### RAG (`services/rag`)
- `POST /api/rag/query`
  - Validates `RagQuery`
  - Returns stubbed `RagResponse` (empty context)
- `GET /health`

### Planner (`services/planner`)
- `POST /api/planner/plan`
  - Validates `PlannerRequest`
  - Returns deterministic planning output (basic platform detection + defaults)
- `GET /health`

### Generator (`services/generator`)
- `POST /api/generator/generate`
  - Validates `GeneratorRequest`
  - Returns deterministic generator output with firmware, wiring, metadata, and simulation JSON
- `GET /health`

### Validator (`services/validator`)
- `POST /api/validator/validate`
  - Validates `ValidatorRequest`
  - Returns structured errors/warnings (duplicate pins, missing libraries, etc.)
- `GET /health`

### Simulator (`services/simulator`)
- `POST /api/simulator/run`
  - Validates `SimulatorRequest`
  - Returns stubbed simulation result
- `GET /health`

### Storage (`services/storage`)
- `POST /api/storage/projects`
- `GET /api/storage/projects/:projectId`
- `PUT /api/storage/projects/:projectId`
- `POST /api/storage/sessions`
- In-memory storage implementation (no database yet)
- `GET /health`

## Not Yet Implemented

- RAG integration with `wireup-hybrid-rag`
- Simulator integration with `velxio`
- Persistent storage (PostgreSQL or similar)
- Authentication and session enforcement
- Event bus integration (NATS/Kafka) for async workflows
- Production hardening (rate limits, circuit breakers, observability)

## Streaming Behavior

- Orchestrator emits `StreamEvent` SSE payloads.
- Gateway proxies the stream to the client.
- Stream closes with `[DONE]`.
