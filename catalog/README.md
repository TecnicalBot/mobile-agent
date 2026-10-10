# Remote catalogs

## Chat composer tip

Edit `chat-tip.json` on `main` to change the text below the chat input without
shipping a new app version (after the version with this feature is installed).
The app checks on launch, every 5 minutes while active, and on resume when stale.
GitHub's CDN may take a few minutes to reflect a change. Offline or invalid
responses keep the last in-memory tip, or the bundled default on a fresh launch.

```json
{
  "version": 1,
  "enabled": true,
  "parts": [
    { "text": "Need help? " },
    { "text": "Read the guide", "url": "https://github.com/TecnicalBot/mobile-agent#readme" }
  ]
}
```

- Keep `version` at `1`. Set `enabled` to `false` to hide the tip remotely.
- Up to 8 parts, with at most 180 visible characters in total (URLs do not count).
- Links must use HTTPS; labels are tappable and open the in-app browser.
- Whitespace/newlines are flattened. The UI shows at most **two lines**, with an
  ellipsis on smaller screens or at larger font sizes. Put important links first.
- Content is plain text, not HTML or executable Markdown. Keep it short and never
  include secrets. Invalid content is ignored rather than breaking the composer.

The top-level `version` is the catalog schema version, not a content revision.
Keep it at `1` when adding or updating entries. Incrementing it requires shipping
parser support in the app first; older app releases reject unknown versions.

The app fetches the other catalogs from the `main` branch at runtime and caches them in
memory for 30 minutes. After a catalog change is merged, users receive it when
that cache expires or the app restarts; an app rebuild is not required.

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

## Voice model catalog

The app fetches `voice-models.json` from the `main` branch at runtime, caches it
for 30 minutes, and falls back to the bundled copy when offline. A newly merged
entry appears without rebuilding the app. These are the local Whisper models
offered in Settings > Voice input. Each model requires:

- `id`: Stable, unique lowercase identifier. Do not reuse an old ID.
- `label`: Name shown in Settings > Voice input.
- `description`: Short explanation shown below the name.
- `url`: Public HTTPS URL of the `ggml-*.bin` Whisper model.
- `sizeBytes`: Exact file size, used by download progress and validation.

Changing a model's `url` or `sizeBytes` invalidates any installed copy: the app
verifies the downloaded size against the catalog, so keep both in sync.

## Plugin catalog

The app fetches `plugins.json` from the `main` branch at runtime, caches it for
30 minutes, and falls back to the bundled copy when offline. Each plugin
requires:

- `id`: Stable, unique lowercase identifier. Do not reuse an old ID.
- `label`: Name shown in Settings > Plugins.
- `description`: Short explanation shown below the name.
- `url`: Public HTTPS URL of the plugin `.js` file.
- `author`: Optional display name.

Installing a catalog plugin sets its `sourceUrl`, so the app's plugin updater
refreshes it daily when a newer version is published.

Plugins are **not vendored in this repo**. Each entry points directly at the
upstream `.js` file so the catalog stays small and the app always imports the
latest published version. Add a new plugin by appending an entry with its
upstream raw URL; do not copy plugin files into this repository.

## Skill catalog

The app fetches `skills.json` from the `main` branch at runtime, caches it for
30 minutes, and falls back to the bundled copy when offline. Each skill
requires:

- `id`: Stable, unique lowercase identifier. Do not reuse an old ID.
- `label`: Skill title shown in Settings > Skills (must match the imported
  skill's title for the "Added" state to appear).
- `description`: Short explanation shown below the name.
- `url`: Public HTTPS URL of the skill `SKILL.md` file.
- `author`: Optional display name.
- `source`: Optional `owner/repo` label shown next to the skill name.
- `sourceUrl`: Optional public HTTPS link to the skill's directory.
- `extraFiles`: Optional array of public HTTPS URLs for related files.

Skills are **not vendored in this repo**. Each entry points directly at the
upstream `SKILL.md` (and its supporting files) so the catalog stays small and
the app always imports the latest published version. Add a new skill by
appending an entry with its upstream raw URLs; do not copy skill files into
this repository.

Only catalog HTTPS URLs are accepted; credentials are never embedded in
catalog entries. Keep `extraFiles` in sync with the upstream directory layout
(references, rules, scripts, agents) so imports match what the source project
publishes.
