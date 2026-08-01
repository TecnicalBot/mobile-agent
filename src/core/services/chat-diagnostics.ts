import { Directory, File, Paths } from "expo-file-system";

const DIAGNOSTICS_DIRECTORY_SEGMENTS = ["mobile-agent", "diagnostics"] as const;
const CHAT_RENDER_ERRORS_FILE_NAME = "chat-render-errors.log";

export type ChatRenderErrorPayload = {
  componentStack?: string | null;
  context?: string | null;
  message: string;
  runId?: string | null;
  stack?: string | null;
};

function getDiagnosticsDirectory(): Directory {
  return new Directory(Paths.document, ...DIAGNOSTICS_DIRECTORY_SEGMENTS);
}

function getChatRenderErrorsFile(): File {
  return new File(getDiagnosticsDirectory(), CHAT_RENDER_ERRORS_FILE_NAME);
}

export async function appendChatRenderError(payload: ChatRenderErrorPayload) {
  const entry = JSON.stringify({
    at: new Date().toISOString(),
    ...payload,
  });

  console.error(`[ChatRenderError] ${entry}`);

  try {
    const directory = getDiagnosticsDirectory();

    if (!directory.exists) {
      directory.create({
        idempotent: true,
        intermediates: true,
      });
    }

    getChatRenderErrorsFile().write(`${entry}\n`, { append: true });
  } catch (error) {
    console.error("chat-diagnostics: failed to persist render error", error);
  }
}
