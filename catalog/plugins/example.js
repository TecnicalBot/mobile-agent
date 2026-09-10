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
