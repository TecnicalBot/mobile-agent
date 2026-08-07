import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type {
  PendingQuestionnaireAnswer,
  PendingQuestionnaireRequest,
  ToolExecutionRecord,
} from "@/core/types/app-state";

const MAX_QUESTIONS = 5;
const MAX_CHOICES = 8;
const MAX_FREEFORM_LENGTH = 1000;

let questionnaireSequence = 0;

const questionnaireItemSchema = z.object({
  allowFreeform: z.boolean().optional(),
  choices: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(MAX_CHOICES)
    .optional(),
  description: z.string().trim().max(500).optional(),
  id: z.string().trim().min(1).max(64),
  multiple: z.boolean().optional(),
  prompt: z.string().trim().min(1).max(500),
  required: z.boolean().optional(),
});

export function createAskQuestionTool(input: {
  onRecord?: (record: ToolExecutionRecord) => void;
  requestQuestionnaire: (
    request: PendingQuestionnaireRequest,
  ) => Promise<PendingQuestionnaireAnswer[] | null>;
}) {
  return {
    tools: {
      askQuestion: tool({
        description:
          "Ask the user a short set of questions to clarify the task before continuing. Use only when the request is genuinely ambiguous or lacks essential information; prefer discovering the answer with the available tools first. The run pauses while the user answers. Keep questions specific and offer choices when useful.",
        inputSchema: z.object({
          questions: z
            .array(questionnaireItemSchema)
            .min(1)
            .max(MAX_QUESTIONS),
        }),
        execute: async ({ questions }) => {
          questionnaireSequence += 1;
          const request: PendingQuestionnaireRequest = {
            id: `questionnaire:${Date.now()}:${questionnaireSequence}`,
            items: questions.map((item) => ({
              allowFreeform: item.allowFreeform ?? true,
              choices: item.choices,
              description: item.description ?? null,
              id: item.id,
              multiple: item.multiple ?? false,
              prompt: item.prompt,
              required: item.required ?? true,
            })),
          };
          const inputSummary = summarizeValue({ count: questions.length });

          try {
            const answers = await input.requestQuestionnaire(request);

            if (!answers) {
              throw new Error(
                "The user dismissed the questions. Ask for the missing information in your reply instead.",
              );
            }

            const output = { answers };

            input.onRecord?.(
              createRecord({
                toolName: "askQuestion",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue(output),
              }),
            );

            return output;
          } catch (error) {
            input.onRecord?.(
              createRecord({
                toolName: "askQuestion",
                status: "failed",
                inputSummary,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
            throw error;
          }
        },
      }),
    },
  };
}

export { MAX_FREEFORM_LENGTH };
