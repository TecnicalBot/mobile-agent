import type {
    AppSettings,
    AppStateSnapshot,
    ResolvedConfig,
} from "@/core/types/app-state";
import { DEFAULT_BUILT_IN_TOOL_SETTINGS } from "@/modules/config/built-in-tools";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/modules/notifications/settings";
import { DEFAULT_REMOTE_RENDER_SETTINGS } from "@/modules/preview/remote-render-settings";

export const REQUEST_INACTIVITY_TIMEOUT_MS = 5 * 60_000;

export const STREAMING_SNAPSHOT_INTERVAL_MS = 96;

export const BASE_AGENT_SYSTEM_PROMPT = `
# You are Mobile Agent, an elite assistant built by Technical Bot.

## Info related to Mobile agent:
- Docs: https://mobile-agent.vercel.app/docs
- Issues/Feature request: https://github.com/TecnicalBot/mobile-agent/issues

## Info about the chat renderer we have (Just for your info, Do not announce it):
- Tappable links
- Inline svg render (if svg is given in markdown OR if in format like image for e.g. [some-svg](path/or/link/to/svg))
- Preview Html code block

Reponse:
- Use Github-flavored markdown format.
- Keep your responses clear and concise.
`;

export function buildCurrentDateTimeSystemPrompt() {
    const now = new Date();
    return `Current date and time: ${now.toLocaleString()}.`;
}

export function buildConversationTitle(input: string) {
    const normalized = input.replace(/\s+/g, " ").trim();

    if (!normalized) {
        return "New chat";
    }

    return normalized.length > 48
        ? `${normalized.slice(0, 48).trim()}...`
        : normalized;
}

export function normalizeGeneratedConversationTitle(
    text: string,
    fallback: string,
) {
    const title = text
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean)
        ?.replace(/^[#*\-\s"'`]+|[#*\-\s"'`]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!title) return fallback;
    return title.length > 60 ? `${title.slice(0, 57).trim()}...` : title;
}

export const EMPTY_SETTINGS: AppSettings = {
    activeConversationId: null,
    activeModelRef: null,
    builtInToolSettings: DEFAULT_BUILT_IN_TOOL_SETTINGS,
    databaseMode: "local",
    databaseUrl: null,
    memoryEnabled: true,
    schedulingEnabled: true,
    themeMode: "system",
    notificationSettings: {
        ...DEFAULT_NOTIFICATION_SETTINGS,
    },
    remoteRender: {
        ...DEFAULT_REMOTE_RENDER_SETTINGS,
    },
};

export const EMPTY_RESOLVED_CONFIG: ResolvedConfig = {
    activeProviderIds: [],
    providers: [],
    modelPresets: [],
    suggestedModelsByProvider: {},
    providerModelDiscovery: {},
    availableModels: [],
    activeModels: [],
    currentModel: null,
    currentModelSupportsImageGeneration: false,
    currentModelSupportsImageInput: false,
    currentModelSupportsAudioInput: false,
    currentModelSupportsVideoInput: false,
    currentModelSupportsTools: false,
    databaseMode: "local",
    databaseUrl: null,
};

export const EMPTY_SNAPSHOT: AppStateSnapshot = {
    activeProviderAccountIds: {},
    agentRuns: [],
    agents: [],
    conversations: [],
    conversationApprovalModes: {},
    conversationApprovedTools: {},
    currentConversation: null,
    currentSelectedAgentId: null,
    currentSelectedFileIds: [],
    currentSelectedMcpServerIds: null,
    currentSelectedSkillIds: [],
    memory: null,
    mcpServers: [],
    messages: [],
    pendingInputs: [],
    plugins: [],
    providerAccounts: [],
    savedPrompts: [],
    schedules: [],
    skills: [],
    workspaceFiles: [],
    resolvedConfig: EMPTY_RESOLVED_CONFIG,
    settings: EMPTY_SETTINGS,
};
