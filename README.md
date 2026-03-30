# SOPLangBuilder

Utilities and an MCP-facing SOPLang agent used by Explorer for document builds.

Detailed agent docs:

- [soplangAgent README](./soplangAgent/README.md)

## soplangAgent (global-capable)

- **Location:** `soplangAgent/` (manifest uses `node:20-bullseye`, installs OS dependencies via `scripts/install.sh`).
- **Enable globally from a Ploinky workspace root:**
  - `p-cli enable repo SOPLangBuilder`
  - `p-cli enable agent SOPLangBuilder/soplangAgent global`
  - Start via Ploinky CLI (e.g., `p-cli start soplangAgent` if not already running). See `ploinky/docs/ploinky-overview.md` for `global` semantics and router setup.
- **MCP tools:** `soplangAgent/mcp-config.json` defines:
  - `sync_markdown_documents`
  - `execute_incremental_build`
  - `execute_workspace_build`
  - `build_from_specs_markdown`
  - `get_variables_with_values`
  - `execute_skill`
- All tools execute through `/code/soplang-tool.sh` with `cwd: "workspace"`.
- The wrapper script writes execution output to `last-tool.log` at repo root and sets storage paths in the container: `/persistoStorage`, `/persistoLogs`, `/persistoAudit`.
- **Typical call for Explorer variable refreshes:** use `sync_markdown_documents`.
- **Preferred build after sync:** use `execute_incremental_build` to build only changed documents.
- **Run the full SOPLang pipeline separately:** use `execute_workspace_build`.
- Internal structure is documented in `soplangAgent/README.md`.
