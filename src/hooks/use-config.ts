import {
  useChat as useDirectChat,
  useConfig as useDirectConfig,
} from "@/providers/app-state";
import { useHarness } from "@/providers/harness-state";
import type { ModelRef, ResolvedModel } from "@/core/types/app-state";

function labelDirectSource(model: ResolvedModel): ResolvedModel {
  return /opencode/i.test(model.providerLabel)
    ? { ...model, providerLabel: `${model.providerLabel} (API)` }
    : model;
}

export function useConfig() {
  const direct = useDirectConfig();
  const directChat = useDirectChat();
  const harness = useHarness();
  const model = harness.active
    ? harness.currentModel
    : direct.currentModel
      ? labelDirectSource(direct.currentModel)
      : null;
  return {
    ...direct,
    activeModels: [
      ...direct.activeModels.map(labelDirectSource),
      ...harness.availableModels,
    ],
    currentModel: model,
    currentModelSupportsImageGeneration:
      model?.supportsImageGeneration ?? false,
    currentModelSupportsImageInput: model?.supportsImageInput ?? false,
    currentModelSupportsAudioInput: model?.supportsAudioInput ?? false,
    currentModelSupportsVideoInput: model?.supportsVideoInput ?? false,
    currentModelSupportsTools: model?.supportsTools ?? false,
    selectModel: async (ref: ModelRef) => {
      if (ref.startsWith("harness:")) {
        if (harness.active) {
          await harness.selectModel(ref);
          return;
        }
        const conversation = directChat.currentConversation;
        if (conversation) {
          await harness.attachConversation(conversation.id, ref);
          return;
        }
        await harness.selectModel(ref);
        return;
      }

      if (harness.active) {
        let conversationId: string | null = null;
        try {
          conversationId = await harness.detachConversation();
        } catch (error) {
          console.error("Could not copy the harness transcript locally", error);
        }
        harness.deactivate();
        if (conversationId) {
          await directChat.selectConversation(conversationId);
        }
      }
      await direct.selectModel(ref);
    },
  };
}
