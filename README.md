# SOPLangBuilder

Utilities and an MCP-facing SOPLang agent used by Explorer for document builds.

## soplangAgent (global-capable)

- **Location:** `soplangAgent/` (manifest uses `node:20-alpine`, installs `ffmpeg` in `postinstall`).
- **Enable globally from a Ploinky workspace root:**
  - `p-cli enable repo SOPLangBuilder`
  - `p-cli enable agent SOPLangBuilder/soplangAgent global`
  - Start via Ploinky CLI (e.g., `p-cli start soplangAgent` if not already running). See `ploinky/docs/ploinky-overview.md` for `global` semantics and router setup.
- **MCP tool:** `soplangAgent/mcp-config.json` defines tool `soplang-tool` (command `/code/soplang-tool.sh`, `cwd: "workspace"`).
  - Input payload fields: `pluginName` (string, required), `methodName` (string, required), `params` (array, optional).
  - The wrapper script writes execution output to `last-tool.log` at repo root and sets storage paths in the container: `/persistoStorage`, `/persistoLogs`, `/persistoAudit`.
- **Typical call for Explorer builds:** use `pluginName: "SoplangBuilder"` and `methodName: "buildFromMarkdown"` (add `params` array if the plugin method expects arguments).
