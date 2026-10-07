# Mobile Agent Plugins

Plugins are self-contained JavaScript files imported from Settings > Plugins.
They execute as trusted code inside the app, so only install code you trust.

Each file starts with a one-line JSON manifest:

```js
// @mobile-agent-plugin {"name":"example","version":"1.0.0"}
```

The file assigns a plugin definition to `module.exports`. Its `setup(api,
options)` function returns any combination of:

- `tool`: AI SDK tools described with JSON Schema. Set `mutating: true` to use
  the app's tool approval flow. Each tool supports:
  - `output`: where the result goes — `"model"` (default), `"user"` (result
    rendered for the user, model only gets a stub), `"both"`, or `"silent"`.
  - `timeoutMs`: max execution time in ms (default 120000).
  - `api.ai.generate(...)` is disabled inside tools unless the plugin's
    options set `allowAiInTools: true`.
- `action`: manually-runnable capabilities, same shape as tools
  (`description`, `title?`, `inputSchema?`, `mutating?`, `output?`,
  `timeoutMs?`, `run(args, context)`). Surfaced in Settings > Plugins and as
  chips above the chat composer. Inside actions, `api.ai.generate(...)` is
  always available.
- `system`: prompt segments, or a function returning prompt segments.
- `event`: handlers for `run:start`, `message:delta`, `tool:after`,
  `run:complete`, and `run:failed`.
- `dispose`: cleanup called when plugins reload.

During execution a tool/action can report progress via the second argument to
`execute(args, context)` / `run(args, context)`:

```js
async execute(args, context) {
  context.metadata?.({ title: "Step 2 of 5..." });
  ...
  return {
    title: "Done",
    output: "...",
    attachments: [{ mime: "image/png", uri: "file:///...", filename: "out.png" }],
  };
}
```

`attachments` render as images (for `image/*`) or filename rows in the chat
card / action result.

The host `api` exposes `fetch`, namespaced `storage`, encrypted `secrets`,
`emit`, `log`, and `ai.generate` (one-shot generation with the currently
selected provider/model). `api.fetch` is tied to the active tool/action's
abort signal. Plugins must bundle all dependencies into the single file;
runtime `import` and `require` are not available.

## Secrets

API keys and tokens are entered by the user in Settings > Plugins >
\<plugin> > Secrets, stored encrypted on-device, and never sent to the model.
Reference a secret only by key name:

```js
const token = await api.secrets.get("MY_API_KEY");
```

These key names are discovered automatically (Settings shows a field for each)
and reported to the agent, which directs the user to configure them. Do not
embed literal credentials in plugin code, and never ask the user to paste a
secret into the chat.

See `example.js` for a complete plugin.
