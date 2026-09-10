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
  the app's tool approval flow.
- `system`: prompt segments, or a function returning prompt segments.
- `event`: handlers for `run:start`, `message:delta`, `tool:after`,
  `run:complete`, and `run:failed`.
- `dispose`: cleanup called when plugins reload.

The host `api` exposes `fetch`, namespaced `storage`, encrypted `secrets`,
`emit`, and `log`. Plugins must bundle all dependencies into the single file;
runtime `import` and `require` are not available.

See `example.js` for a complete plugin.
