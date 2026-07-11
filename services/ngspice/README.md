# Ngspice Service

This service wraps a locally built ngspice binary and exposes a REST endpoint used by the Validator.

## Build ngspice (local)

- Unix/macOS:
  - `pnpm --filter @wireup/ngspice build:ngspice:unix`
- Windows (MSYS2/WSL required for autotools):
  - `pnpm --filter @wireup/ngspice build:ngspice:win`

By default the service looks for the binary at:

```
vendor/ngspice/build/dist/bin/ngspice
```

Override with `NGSPICE_BIN`.
