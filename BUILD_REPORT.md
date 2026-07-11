# Build Report

## Scope
This report captures the current build state of the WireUp backend monorepo after installing workspace dependencies and running the repository build.

## Verification Command
- Command: `pnpm install && pnpm build`
- Result: Dependencies installed successfully, but the workspace build did not complete successfully.

## Observed Build Outcome
The build currently fails during TypeScript compilation in the service workspace.

### Verified evidence
- The initial compiler configuration emitted `TS5103: Invalid value for '--ignoreDeprecations'` with the prior setting.
- After updating the workspace config to a value accepted by the installed TypeScript compiler, the build moved on to a new failure:
  - `TS6059: File ... is not under 'rootDir' ...`
- The failure is currently triggered by workspace package imports from shared packages such as `@wireup/types` and `@wireup/utils` when the service compiler is constrained by its local `rootDir`.

## Current Assessment
The repository is not in a fully green build state at the moment. The blocker is a TypeScript configuration and package-resolution issue rather than a runtime feature change.

## Recommended next step
Resolve the shared-package compilation layout so the service-level TypeScript projects can compile against workspace packages without `rootDir` conflicts.
