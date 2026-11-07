import {
  acpHostUploadUrl,
  uploadAcpHostFile,
} from "@/modules/harnesses/acp-host-files";

export const claudeHostUploadUrl = acpHostUploadUrl;

export function uploadClaudeHostFile(
  input: Omit<Parameters<typeof uploadAcpHostFile>[0], "agentLabel">,
) {
  return uploadAcpHostFile({ ...input, agentLabel: "Claude" });
}
