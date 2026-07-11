# WireUp Backend Architecture (Draft)

## 1) Folder Structure

```
packages/
  schemas/           # Zod schemas for all service contracts
  types/             # TypeScript types shared across services
  utils/             # HTTP client + shared errors
services/
  gateway/           # Frontend entry + auth/session + streaming
  orchestrator/      # Pipeline coordination + state updates
  rag/               # Hybrid retrieval (wireup-hybrid-rag integration point)
  planner/           # Execution planning
  generator/         # Deterministic generation outputs
  validator/         # Circuit + firmware validation
  simulator/         # Velxio integration point
  storage/           # Project/session persistence
```

## 2) Service Architecture

| Service | Responsibility | Notes |
| --- | --- | --- |
| Gateway | Auth + session management, request intake, SSE streaming to UI | Stateless; forwards to Orchestrator |
| Orchestrator | Pipeline brain; retries, state updates, streaming events | Calls all other services via APIs |
| RAG | Hybrid retrieval + ranking | Returns structured context only |
| Planner | Build execution plan from prompt + context | Deterministic JSON |
| Generator | Generate firmware + wiring + components | Deterministic JSON |
| Validator | Pin/voltage/library/sim compatibility validation | Returns structured errors |
| Simulator | Circuit simulation engine | No AI logic |
| Storage | Durable storage for projects/sessions/history | API-only access |

## 3) API Contracts (REST)

All services return the common envelope:

```json
{ "success": true, "data": { /* payload */ } }
```

Errors:

```json
{ "success": false, "error": { "code": "...", "message": "...", "details": {} } }
```

### Gateway
- `POST /api/chat` (SSE)
  - Body: `GatewayRequest`
  - Stream: `StreamEvent` messages + `[DONE]`

### Orchestrator
- `POST /api/orchestrate` (SSE)
  - Body: `GatewayRequest`
  - Stream: `StreamEvent` messages + `[DONE]`

### RAG
- `POST /api/rag/query`
  - Body: `RagQuery`
  - Response: `RagResponse`

### Planner
- `POST /api/planner/plan`
  - Body: `PlannerRequest`
  - Response: `PlannerResponse`

### Generator
- `POST /api/generator/generate`
  - Body: `GeneratorRequest`
  - Response: `GeneratorResponse`

### Validator
- `POST /api/validator/validate`
  - Body: `ValidatorRequest`
  - Response: `ValidatorResponse`

### Simulator
- `POST /api/simulator/run`
  - Body: `SimulatorRequest`
  - Response: `SimulatorResponse`

### Storage
- `POST /api/storage/projects`
  - Body: `StorageProjectCreateRequest`
  - Response: `StorageProject`
- `GET /api/storage/projects/:projectId`
  - Response: `StorageProject`
- `PUT /api/storage/projects/:projectId`
  - Body: `StorageProjectUpdateRequest`
  - Response: `StorageProject`
- `POST /api/storage/sessions`
  - Body: `StorageSessionCreateRequest`
  - Response: `Session`

## 4) Internal Data Flow

```
User Prompt
  -> Gateway
  -> Orchestrator
     -> RAG
     -> Planner
     -> Generator
     -> Validator
     -> Simulator
     -> Storage
  -> Gateway (SSE stream)
```

## 5) JSON Schemas

All JSON schemas are defined in `packages/schemas/src/index.ts` using Zod and mirror the TypeScript types in `packages/types/src/index.ts`.

Key schemas:
- `RagQuerySchema`, `PlannerRequestSchema`, `GeneratorRequestSchema`, `ValidatorRequestSchema`, `SimulatorRequestSchema`
- `StorageProjectCreateRequestSchema`, `StorageProjectUpdateRequestSchema`, `StorageSessionCreateRequestSchema`

## 6) Database Schema (Proposed)

```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE planner_outputs (
  project_id UUID REFERENCES projects(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE generator_outputs (
  project_id UUID REFERENCES projects(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE validator_outputs (
  project_id UUID REFERENCES projects(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE simulation_runs (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES projects(id),
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  is_active BOOLEAN NOT NULL
);
```

## 7) Event Flow

- `plan_start` → `plan_progress` → `plan_complete`
- `generation_start` → `generation_progress` → `generation_complete`
- `validation_start` → `validation_progress` → `validation_complete`
- `simulation_start` → `simulation_progress` → `simulation_complete`
- `error`

Events are emitted by Orchestrator and streamed through Gateway as SSE.

## 8) Error Handling Strategy

- Validate all requests with Zod schemas.
- Return `ApiResponse` error envelopes with structured `code` + `details`.
- Orchestrator retries are handled by `ServiceClient` (retry/timeout configured).
- On failure, Orchestrator emits an `error` stream event and updates project status to `error` when possible.

## 9) Streaming Architecture

- Orchestrator performs the pipeline and emits `StreamEvent` objects.
- Gateway proxies the SSE stream to the frontend.
- The stream terminates with `[DONE]`.

## 10) Production-Ready Implementation Plan

1. **Replace stubs with integrations**
   - RAG → `wireup-hybrid-rag`
   - Simulator → `velxio`
2. **Add persistence layer**
   - PostgreSQL + migration tooling (e.g., Prisma/Drizzle)
3. **Authentication + session management**
   - JWT + refresh tokens + session store
4. **Eventing + resilience**
   - Async bus for long-running flows (NATS/Kafka)
5. **Observability**
   - OpenTelemetry traces, structured logging
6. **Production hardening**
   - Rate limits, retries, idempotency, circuit breakers
7. **Deployment**
   - Containerize each service, deploy with autoscaling
