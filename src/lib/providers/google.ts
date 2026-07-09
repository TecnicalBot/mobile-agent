import type { SupportedProviderDefinition } from "@/lib/providers/types";

export const GOOGLE_PROVIDER = {
  config: {
    id: "google",
    family: "google",
    label: "Google Gemini",
    authType: "apiKey",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    enabled: false,
    oauthAccountEmail: null,
  },
  models: [
    {
      id: "gemini-3.1-flash-image",
      kind: "chat",
      label: "Gemini 3.1 Flash Image",
      capabilities: {
        imageGeneration: true,
        imageInput: true,
        tools: false,
      },
    },
    {
      id: "gemini-3-pro-image",
      kind: "chat",
      label: "Gemini 3 Pro Image",
      capabilities: {
        imageGeneration: true,
        imageInput: true,
        tools: false,
      },
    },
    {
      id: "gemini-3.1-flash-lite-image",
      kind: "small",
      label: "Gemini 3.1 Flash Lite Image",
      capabilities: {
        imageGeneration: true,
        imageInput: true,
        tools: false,
      },
    },
    {
      id: "gemini-2.5-flash-image",
      kind: "chat",
      label: "Gemini 2.5 Flash Image",
      capabilities: {
        imageGeneration: true,
        imageInput: true,
        tools: false,
      },
    },
    {
      id: "gemini-2.5-flash",
      kind: "chat",
      label: "Gemini 2.5 Flash",
    },
    {
      id: "gemini-2.5-pro",
      kind: "chat",
      label: "Gemini 2.5 Pro",
    },
    {
      id: "gemini-2.5-flash-lite",
      kind: "small",
      label: "Gemini 2.5 Flash Lite",
    },
    {
      id: "gemini-2.0-flash",
      kind: "chat",
      label: "Gemini 2.0 Flash",
    },
  ],
} satisfies SupportedProviderDefinition;
