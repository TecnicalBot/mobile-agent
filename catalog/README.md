# Remote catalogs

The top-level `version` is the catalog schema version, not a content revision.
Keep it at `1` when adding or updating entries. Incrementing it requires shipping
parser support in the app first; older app releases reject unknown versions.

The app fetches `mcp-servers.json` from the `main` branch at runtime and caches
it in memory for 30 minutes. After a catalog change is merged, users receive it
when that cache expires or the app restarts; an app rebuild is not required.

Each server supports these fields:

- `id`: Stable, unique catalog identifier.
- `label`: Name shown in the app.
- `description`: Short explanation shown below the name.
- `url`: Public HTTPS MCP endpoint.
- `transport`: `http` or `sse`.
- `authMode`: `none`, `oauth`, or `headers`.
- `headerTemplate`: Optional public placeholder shown in the headers field.
- `oauthClientId`, `oauthAuthorizationUrl`, `oauthTokenUrl`, `oauthScopes`, and
  `oauthAllowedAuthOrigin`: Optional public OAuth overrides.

Never add API keys, access tokens, client secrets, or private headers to this
file. User credentials remain in the app's secure on-device secret store.

## On-device model catalog

The app fetches `on-device-models.json` from the `main` branch at runtime,
caches it in memory for 30 minutes, and falls back to the bundled copy when
offline. A newly merged entry can appear without rebuilding the app.

Only add model files compatible with the LiteRT-LM engine (`.litertlm`). Each
model requires:

- `id`: Stable, unique lowercase identifier. Do not reuse an old ID.
- `name`: Name shown in Settings.
- `parameterCount` and `quantization`: Short display labels.
- `downloadUrl`: Public HTTPS URL for the model file.
- `sha256`: Exact 64-character file hash used for integrity verification.
- `sizeBytes`: Exact file size used by download progress and validation.
- `contextWindow`: Practical token limit for this packaged model.
- `minRamBytes`: Minimum device RAM required to enable it.
- `supportedPlatforms`: Any combination of `ios` and `android`.
- `license`: Model-weight license shown to the user.
- `capabilities.tools` and `capabilities.reasoning`: UI/runtime capability flags.

Test the exact URL, size, hash, and device memory requirement before merging.
Changing a URL without changing its pinned size and hash will make the download
fail safely.
