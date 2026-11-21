import { createAnalyzeAudioTool } from "@/modules/tools/built-in/analyze-audio";
import { createCreateFileTool } from "@/modules/tools/built-in/create-file";
import { createDownloadFileTool } from "@/modules/tools/built-in/download-file";
import { createEditTool } from "@/modules/tools/built-in/edit";
import { createFetchPageTool } from "@/modules/tools/built-in/fetch-page";
import { createVideoFrameTool } from "@/modules/tools/built-in/video-frame";
import { createGlobTool } from "@/modules/tools/built-in/glob";
import { createGrepTool } from "@/modules/tools/built-in/grep";
import { createListFilesTool } from "@/modules/tools/built-in/list-files";
import { createListVoicesTool } from "@/modules/tools/built-in/list-voices";
import { createMergeDocumentsTool } from "@/modules/tools/built-in/merge-documents";
import { createMergePdfsTool } from "@/modules/tools/built-in/merge-pdfs";
import { createOcrTool } from "@/modules/tools/built-in/ocr";
import { createPreviewMixTool } from "@/modules/tools/built-in/preview-mix";
import { createPreviewSceneTool } from "@/modules/tools/built-in/preview-scene";
import {
  buildSelectedFilesInlineContext,
  buildWorkspaceSystemPrompt,
} from "@/modules/tools/built-in/prompts";
import { createBrowserTool } from "@/modules/tools/built-in/browser";
import { createReadTool } from "@/modules/tools/built-in/read";
import { createRenderVideoTool } from "@/modules/tools/built-in/render-video";
import { createSplitDocumentTool } from "@/modules/tools/built-in/split-document";
import { createSplitPdfTool } from "@/modules/tools/built-in/split-pdf";
import { createTextToSpeechTool } from "@/modules/tools/built-in/text-to-speech";
import { createTranscribeAudioTool } from "@/modules/tools/built-in/transcribe-audio";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { createUpdateDocumentTool } from "@/modules/tools/built-in/update-document";
import { createViewFileTool } from "@/modules/tools/built-in/view-file";
import { createWriteTool } from "@/modules/tools/built-in/write";
import type { ExternalFolderSession } from "@/core/types/app-state";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";

export function createWorkspaceTools(
  params: WorkspaceToolFactoryParams & {
    session?: ExternalFolderSession | null;
  },
) {
  if (params.conversationId) {
    params = {
      ...params,
      repository: params.repository.forConversation?.(params.conversationId) ?? params.repository,
    };
  }
  return {
    tools: {
      analyzeAudio: createAnalyzeAudioTool(params),
      browser: createBrowserTool(params),
      createFile: createCreateFileTool(params),
      downloadFile: createDownloadFileTool({ ...params, session: params.session }),
      edit: createEditTool(params),
      fetchPage: createFetchPageTool(params),
      getVideoFrame: createVideoFrameTool(params),
      glob: createGlobTool(params),
      grep: createGrepTool(params),
      listFiles: createListFilesTool(params),
      listVoices: createListVoicesTool(params),
      mergeDocuments: createMergeDocumentsTool(params),
      mergePdfs: createMergePdfsTool(params),
      ocr: createOcrTool(params),
      previewScene: createPreviewSceneTool(params),
      previewMix: createPreviewMixTool(params),
      read: createReadTool(params),
      renderVideo: createRenderVideoTool(params),
      splitDocument: createSplitDocumentTool(params),
      splitPdf: createSplitPdfTool(params),
      textToSpeech: createTextToSpeechTool(params),
      transcribeAudio: createTranscribeAudioTool(params),
      updateDocument: createUpdateDocumentTool(params),
      viewFile: createViewFileTool(params),
      write: createWriteTool(params),
    },
    workspaceService: createWorkspaceFileService(params.repository),
  };
}

export { buildSelectedFilesInlineContext, buildWorkspaceSystemPrompt };
