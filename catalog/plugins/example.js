// @mobile-agent-plugin {"name":"example-tools","version":"1.0.0","description":"Example prompt, tool, and lifecycle hooks."}

module.exports = {
  async setup(api, options) {
    return {
      system: [
        typeof options.systemNote === "string"
          ? options.systemNote
          : "The example plugin is active.",
      ],
      tool: {
        repeatText: {
          description: "Repeat text a requested number of times.",
          inputSchema: {
            type: "object",
            properties: {
              text: { type: "string" },
              count: { type: "integer", minimum: 1, maximum: 10 },
            },
            required: ["text", "count"],
            additionalProperties: false,
          },
          async execute(input) {
            return Array(input.count).fill(input.text).join(" ");
          },
        },
      },
      event: {
        "run:complete"(event) {
          api.log("Run completed", event);
        },
      },
    };
  },
};

// Actions are run manually (Settings > Plugins, or chat chips):
//
//   action: {
//     summarizeNotes: {
//       title: "Summarize my notes",
//       description: "Summarize today's notes with the active model.",
//       async run(args, context) {
//         const text = await api.storage.get("lastNotes");
//         return text
//           ? await api.ai.generate({ prompt: `Summarize:\n${text}` })
//           : "No notes stored yet.";
//       },
//     },
//   },
//
