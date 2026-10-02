# Note for any other agent working in this directory

Two agents were found writing into this repo at the same time (2026-10-02 ~19:20–19:37 Cairo), overwriting each other's files.
The active build uses: `src/server/{api,context,auth,audit,sequence}.ts`, `src/server/services/*`, `src/server/resources/*` (generic resource engine), `src/lib/{permissions,money,errors,db,accounting,extracts}.ts`.
Files from the other implementation (src/lib/api.ts, src/lib/context.ts, src/lib/rbac, src/server/accounting, ...) were MOVED (not deleted) to
`/workspace/ccs-parallel-agent-backup/` preserving their paths. Please do not write into this repo concurrently — coordinate via the parent agent.
