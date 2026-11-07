import type {
  AcpModel,
  AcpNewSessionResult,
  AcpPermissionOption,
  AcpPermissionRequest,
  AcpSessionConfigOption,
  AcpSessionMode,
  AcpSessionModeState,
  AcpSessionUpdate,
} from "./acp-client";
import {
  acpModeForState,
  acpModelSelection,
  acpModels,
  acpPermissionOption,
  applyAcpUpdate,
  beginAcpTurn,
  buildAcpContext,
  createAcpSessionState,
  detachAcpTurn,
  finishAcpTurn,
  presentAcpAgent,
  presentAcpConversation,
  presentAcpModel,
  presentAcpPermission,
  type AcpSessionState,
  type PendingAcpPermission,
} from "./acp-presentation";
import { CLAUDE_PROFILE, acpModelRef } from "./acp-profile";
import type { AgentConfig, Conversation, ResolvedModel, StoredMessage } from "@/core/types/app-state";

export const CLAUDE_PROVIDER_ID = CLAUDE_PROFILE.providerId;

export const claudeModelRef = (modelId: string) =>
  acpModelRef(CLAUDE_PROFILE, modelId);

export type ClaudeSessionState = AcpSessionState;
export type PendingClaudePermission = PendingAcpPermission;

export function createClaudeSessionState(input: {
  result: AcpNewSessionResult;
  cwd: string;
  messages?: StoredMessage[];
  createdAt?: string;
}): ClaudeSessionState {
  return createAcpSessionState(CLAUDE_PROFILE, input);
}

export function beginClaudeTurn(
  state: ClaudeSessionState,
  content: string,
  createdAt?: string,
  selectedFileIds: string[] = [],
): ClaudeSessionState {
  return beginAcpTurn(state, content, createdAt, selectedFileIds);
}

export function finishClaudeTurn(
  state: ClaudeSessionState,
  stopReason: string | null,
  failed = false,
  finishedAt?: string,
): ClaudeSessionState {
  return finishAcpTurn(CLAUDE_PROFILE, state, stopReason, failed, finishedAt);
}

export function detachClaudeTurn(
  state: ClaudeSessionState,
  finishedAt?: string,
): ClaudeSessionState {
  return detachAcpTurn(CLAUDE_PROFILE, state, finishedAt);
}

export function applyClaudeUpdate(
  state: ClaudeSessionState,
  update: AcpSessionUpdate,
  at?: string,
): ClaudeSessionState {
  return applyAcpUpdate(CLAUDE_PROFILE, state, update, at);
}

export function presentClaudeConversation(
  state: ClaudeSessionState,
): Conversation {
  return presentAcpConversation(CLAUDE_PROFILE, state);
}

export function presentClaudeAgent(mode: AcpSessionMode): AgentConfig {
  return presentAcpAgent(mode);
}

export function presentClaudeModel(model: AcpModel): ResolvedModel {
  return presentAcpModel(CLAUDE_PROFILE, model);
}

export function claudeModelSelection(
  model: AcpModel,
  configOptions: AcpSessionConfigOption[],
) {
  return acpModelSelection(model, configOptions);
}

export function claudeModels(
  result: Pick<AcpNewSessionResult, "models" | "configOptions">,
): AcpModel[] {
  return acpModels(result);
}

export function claudeModeForState(
  state: ClaudeSessionState,
): AcpSessionModeState | null {
  return acpModeForState(state);
}

export function presentClaudePermission(
  request: AcpPermissionRequest & { id?: string | number },
  chatTitle: string,
): PendingClaudePermission {
  return presentAcpPermission(CLAUDE_PROFILE, request, chatTitle);
}

export function claudePermissionOption(
  options: AcpPermissionOption[],
  decision: "once" | "always" | "reject",
): AcpPermissionOption | null {
  return acpPermissionOption(options, decision);
}

export function buildClaudeContext(
  messages: StoredMessage[],
  syncedMessageIDs: string[],
) {
  return buildAcpContext(CLAUDE_PROFILE, messages, syncedMessageIDs);
}
