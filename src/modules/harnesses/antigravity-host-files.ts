import {
  acpHostUploadUrl,
  uploadAcpHostFile,
} from "@/modules/harnesses/acp-host-files";

export const antigravityHostUploadUrl = acpHostUploadUrl;

export function uploadAntigravityHostFile(
  input: Omit<Parameters<typeof uploadAcpHostFile>[0], "agentLabel">,
) {
  return uploadAcpHostFile({ ...input, agentLabel: "Antigravity" });
}
