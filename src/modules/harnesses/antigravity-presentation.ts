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
import { ANTIGRAVITY_PROFILE, acpModelRef } from "./acp-profile";
import type { AgentConfig, Conversation, ResolvedModel, StoredMessage } from "@/core/types/app-state";

export const ANTIGRAVITY_PROVIDER_ID = ANTIGRAVITY_PROFILE.providerId;

export const antigravityModelRef = (modelId: string) =>
  acpModelRef(ANTIGRAVITY_PROFILE, modelId);

export type AntigravitySessionState = AcpSessionState;
export type PendingAntigravityPermission = PendingAcpPermission;

export function createAntigravitySessionState(input: {
  result: AcpNewSessionResult;
  cwd: string;
  messages?: StoredMessage[];
  createdAt?: string;
}): AntigravitySessionState {
  return createAcpSessionState(ANTIGRAVITY_PROFILE, input);
}

export function beginAntigravityTurn(
  state: AntigravitySessionState,
  content: string,
  createdAt?: string,
  selectedFileIds: string[] = [],
): AntigravitySessionState {
  return beginAcpTurn(state, content, createdAt, selectedFileIds);
}

export function finishAntigravityTurn(
  state: AntigravitySessionState,
  stopReason: string | null,
  failed = false,
  finishedAt?: string,
): AntigravitySessionState {
  return finishAcpTurn(
    ANTIGRAVITY_PROFILE,
    state,
    stopReason,
    failed,
    finishedAt,
  );
}

export function detachAntigravityTurn(
  state: AntigravitySessionState,
  finishedAt?: string,
): AntigravitySessionState {
  return detachAcpTurn(ANTIGRAVITY_PROFILE, state, finishedAt);
}

export function applyAntigravityUpdate(
  state: AntigravitySessionState,
  update: AcpSessionUpdate,
  at?: string,
): AntigravitySessionState {
  return applyAcpUpdate(ANTIGRAVITY_PROFILE, state, update, at);
}

export function presentAntigravityConversation(
  state: AntigravitySessionState,
): Conversation {
  return presentAcpConversation(ANTIGRAVITY_PROFILE, state);
}

export function presentAntigravityAgent(mode: AcpSessionMode): AgentConfig {
  return presentAcpAgent(mode);
}

export function presentAntigravityModel(model: AcpModel): ResolvedModel {
  return presentAcpModel(ANTIGRAVITY_PROFILE, model);
}

export function antigravityModelSelection(
  model: AcpModel,
  configOptions: AcpSessionConfigOption[],
) {
  return acpModelSelection(model, configOptions);
}

export function antigravityModels(
  result: Pick<AcpNewSessionResult, "models" | "configOptions">,
): AcpModel[] {
  return acpModels(result);
}

export function antigravityModeForState(
  state: AntigravitySessionState,
): AcpSessionModeState | null {
  return acpModeForState(state);
}

export function presentAntigravityPermission(
  request: AcpPermissionRequest & { id?: string | number },
  chatTitle: string,
): PendingAntigravityPermission {
  return presentAcpPermission(ANTIGRAVITY_PROFILE, request, chatTitle);
}

export function antigravityPermissionOption(
  options: AcpPermissionOption[],
  decision: "once" | "always" | "reject",
): AcpPermissionOption | null {
  return acpPermissionOption(options, decision);
}

export function buildAntigravityContext(
  messages: StoredMessage[],
  syncedMessageIDs: string[],
) {
  return buildAcpContext(ANTIGRAVITY_PROFILE, messages, syncedMessageIDs);
}
