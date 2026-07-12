# MongoDB Debug Guide

## Connection Flow

1. The RAG service loads the root `.env`.
2. RAG configuration is parsed from environment variables.
3. Startup prints the MongoDB URI with the password masked, the database name, the collections, the required Atlas Search index names, and the embedding provider.
4. The service attempts to connect to MongoDB with retry and exponential backoff.
5. After a successful connection it runs `ping`, verifies collections, and checks Atlas Search index names.
6. `/health` reports the last MongoDB state and any failure reason.

## Required Environment Variables

- `MONGODB_URI`
- `MONGODB_DATABASE`
- `MONGODB_COLLECTION_DOCUMENTS`
- `MONGODB_COLLECTION_CHUNKS`
- `MONGODB_COLLECTION_KG`
- `MONGODB_VECTOR_INDEX`
- `MONGODB_TEXT_INDEX`
- `MONGODB_KG_TEXT_INDEX`
- `LLM_PROVIDER`
- `LLM_API_KEY` or `OPENAI_API_KEY` for remote LLM providers
- `LLM_MODEL`
- `LLM_BASE_URL`
- `EMBEDDING_PROVIDER`
- `EMBEDDING_API_KEY` for remote embedding providers except `ollama`
- `EMBEDDING_MODEL`
- `EMBEDDING_BASE_URL`

## Supported Provider Values

The backend accepts these provider names in a case-insensitive way and normalizes them to lowercase:

- `openai`
- `gemini`
- `openrouter`
- `ollama`
- `local`

`LOG_LEVEL` is also case-insensitive and normalizes to one of:

- `debug`
- `info`
- `warn`
- `error`

## Required Collections

The service expects these collections in the configured database:

- `documents`
- `chunks`
- `knowledge_graph`

Missing collections are created automatically during startup.

## Required Atlas Search Indexes

The service checks for these index names:

- `vector_index` on the chunks collection
- `text_index` on the chunks collection
- `kg_text_index` on the knowledge graph collection

If an index is missing, the service prints a warning and continues running.

## Common Connection Errors

### Authentication failed

Typical causes:

- Wrong username or password in `MONGODB_URI`
- User does not have access to the target cluster or database
- Password contains special characters that need URL encoding

### Server selection timeout

Typical causes:

- Atlas cluster is paused or unavailable
- Network path to Atlas is blocked
- DNS or firewall issues prevent server discovery

### DNS lookup failed

Typical causes:

- Incorrect cluster hostname
- Local DNS failure
- Corporate network or proxy interference

### TLS error

Typical causes:

- Outdated TLS configuration
- Corporate proxy intercepting the connection
- Broken certificate trust chain

## Authentication Troubleshooting

- Confirm the username and password in `MONGODB_URI`.
- Verify the Atlas database user exists and is enabled.
- Confirm the user has at least read access for health checks and read/write access for normal query execution.
- URL-encode any special characters in the password.

## IP Whitelist Troubleshooting

- Confirm the current machine or container IP is allowed in Atlas Network Access.
- If running in Docker, confirm the container host IP is allowed.
- For local development, verify the Atlas cluster allows your current public IP.

## TLS Troubleshooting

- Confirm the cluster uses the expected TLS settings.
- Remove proxy or antivirus interception if it breaks certificate validation.
- Check for certificate trust issues on the host running the service.

## What To Look For In Logs

- `mongo_connect_attempt`
- `mongo_ping_attempt`
- `mongo_ping_success`
- `mongo_collections_verified`
- `mongo_search_indexes_verified`
- `mongo_search_index_missing`
- `mongo_connection_failed`

The failure log includes the error name, message, code, stack trace, and a classified reason such as:

- `Authentication failed`
- `Server selection timeout`
- `DNS lookup failed`
- `TLS error`
- `Connection timeout`
- `Network connection failed`
