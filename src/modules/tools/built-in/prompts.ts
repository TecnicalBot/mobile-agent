import type { WorkspaceRepository } from "@/core/db/database";
import {
  createWorkspaceFileService,
  isDocumentWorkspaceFile,
  isTextWorkspaceFile,
} from "@/core/services/workspace-file-service";

function buildFullWorkspaceSystemPrompt() {
  return [
    "The shared workspace contains user-visible files.",
    "Answer in chat by default. Only create a workspace file when the user explicitly asks to create, save, or export a file.",
    "Only write to an existing workspace file when the user explicitly asks to modify that file.",
    "Do not create or modify workspace files merely to preserve a response, keep scratch notes, archive a conversation, or store context for your own future use.",
    "Internal runtime artifacts are stored separately, and durable user facts belong in memory rather than workspace files.",
    "If a file request is ambiguous, respond in chat and ask whether the user wants it saved as a file.",
    "To export a document, call createFile with format set to docx (Word), pdf, pptx (PowerPoint) or xlsx (Excel). Provide Markdown or plain text as content: Markdown headings (#, ##) become titles/slides, pipe tables become tables, and a horizontal rule (---) starts a new page or slide. The source content is stored with the document so it can be updated later. For docx you can fully control formatting with a YAML front-matter block at the top of the content: a format key with page (size A3/A4/A5/LETTER/LEGAL/TABLOID, orientation, margins in pt), fonts (body/headings/code/table/header/footer with family, sizePt, color, bold, italic), paragraphs (spacingAfterPt, lineSpacing, alignment), headingStyles (per-level sizePt, color, bold, family), codeBlock (background, textColor), tables (headerBackground, borderColor, ...), header/footer text (with {PAGE} for page numbers), pageNumberPosition, includeToc, and images. For pdf the same format/spec mechanism controls page (size A3/A4/A5/LETTER/LEGAL/TABLOID, orientation, margins in pt), fonts (body/headings/code/table/header/footer with family, sizePt, color, bold, italic), paragraphs (spacingAfterPt, lineSpacing, alignment left/center/right/justified), headingStyles (per-level sizePt, color, bold, spacing), codeBlock (background, textColor), lists (indentPt, spacingAfterPt), tables (headerBackground, headerTextColor, headerBold, borderColor), header/footer text (with {PAGE} for page numbers), pageNumberPosition, and images (defaultWidthPt, maxHeightPt). PDF output uses the standard PDF fonts, so font families are approximated (serif family names render as Times, monospace as Courier, everything else as Helvetica). For xlsx the same format/spec mechanism controls the spreadsheet: sheet (defaultColumnWidth, defaultRowHeight, headerRowHeightPt, showGridLines, freezeHeaderRow, freezeRows, freezeColumns, autoFilter, tabColor, orientation, paperSize, fitToWidth, merges), header and body cell styles (font {family, sizePt, color, bold, italic, underline, strike}, fill {pattern, color}, border {top/bottom/left/right each {style, color}}, alignment {horizontal, vertical, wrapText, indent, textRotation}, numberFormat such as \"#,##0.00\", \"0%\", \"yyyy-mm-dd\"), stripes {enabled, fill} for alternating row shading, and columns (a sparse array of per-column overrides with width, numberFormat, horizontal, vertical, wrapText, fill, bold, italic, color, sizePt, family, headerFill, headerColor, headerBold). For pptx the same format/spec mechanism controls the slide deck: presentation (layout 16x9/16x10/4x3/wide/custom, with widthIn/heightIn in inches for custom, plus title, author, company, subject, rtlMode), theme (headFontFace, bodyFontFace), background (color, image), cover (enabled, title, subtitle) for an optional title slide, title and body text boxes (font {family, sizePt, color, bold, italic}, align, valign, positions/sizes in inches via xIn/yIn/wIn/hIn, lineSpacing, paraSpaceAfterPt, bullet {enabled, color, character}, autoFit, minFontSizePt), heading (sizePt, color, bold, spaceBeforePt), code (fontFamily, sizePt, color, fill), table (font, headerFill, headerColor, headerBold, stripeFill, borderColor, borderPt, xIn/yIn/wIn, rowHeightIn, autoPage), footer (text, color, sizePt, align), slideNumber (show, color, sizePt, align) and images (defaultWidthIn, maxHeightIn). For example: ---\\nformat:\\n  page: { size: LETTER, marginTopPt: 60 }\\n  fonts: { body: { family: Georgia, sizePt: 12 } }\\n  footer: { text: 'Page {PAGE}' }\\n---\\n ... You may pass the same object as the spec parameter instead. Embed images with ![alt](workspace-path-or-data-uri), optionally sized: ![alt](images/logo.png). Follow the user's stated preferences for fonts, colors and layout; when they are not stated, pick sensible defaults.",
    "To update an existing document in place, call updateDocument with the fileId and the new full content (same rules as createFile; the document keeps its format and name). The stored source keeps its front-matter format spec, so the document's styling survives updates automatically; pass a spec parameter to restyle. Imported docx, xlsx and pptx files also keep their original look automatically (their styling is captured on import and returned by read as sourceSpec; an explicit front-matter format or spec parameter overrides it). For targeted changes, use edit on a document — edits apply to its stored source Markdown (read returns it as sourceMarkdown) and the document is regenerated. For large documents, read returns a sections list (index, level, title, size) instead of the whole source; pass section to read one section at a time, and pass section (a 0-based index) plus content (which must start with a Markdown heading) to updateDocument to rewrite just that section, or use sectionMode insertBefore/insertAfter/append/delete to restructure. Documents without stored source (for example imported files) can still be replaced via updateDocument with full new content.",
    "grep searches file contents including documents (docx, xlsx, pptx, pdf); document text is extracted automatically before matching.",
    'To split a pdf into page-range parts, call splitPdf with 1-based page ranges (for example "1-3,5,7-9"). To merge pdfs into one, call mergePdfs with the fileIds in the desired order; the sources are left untouched and new pdf files are created. For docx, xlsx and pptx, split by 0-based section ranges matching the sections list from read (for example "0-2,4", or "each" for one file per section) with splitDocument; merge them with mergeDocuments (same format, order given by fileIds). Documents with stored source, and imported docx files, split by heading sections and the resulting parts stay editable; imported pptx and xlsx files without stored source are split losslessly by slide or sheet instead (binary parts that cannot be edited in place).',
    "To read text that is locked inside an image (screenshots, scanned pages, photos of text), call ocr with the image fileId. OCR requires a build with the native expo-text-extractor module; if it reports unavailable, tell the user.",
    "To look at any file (images, PDFs, audio, or any other file), call viewFile with the fileId. This passes the file bytes to the model — use it to describe, compare, or read all files from listFiles. Do not use read for images or other binary files (text/docs only) and do not use ocr when the user wants the actual file content.",
    "When the user asks to download a file from a URL, use the downloadFile tool. Set target to \"folder\" only when the user wants the file saved in the granted external folder: omit destinationPath to save at the granted folder root, or set destinationPath to an existing subfolder. Otherwise downloadFile saves into the workspace. downloadFile never creates folders.",
  ].join("\n");
}

/**
 * Workspace instructions scoped to the tools the model can actually see.
 * Document paragraphs are long; leaving them in a core-only chat wastes
 * thousands of tokens, so each is dropped when its tool family is off.
 */
export function buildWorkspaceSystemPrompt(input?: { tools?: string[] }) {
  const prompt = buildFullWorkspaceSystemPrompt();

  if (!input?.tools) {
    return prompt;
  }

  const tools = new Set(input.tools);
  const hasAny = (names: string[]) => names.some((name) => tools.has(name));

  return prompt
    .split("\n")
    .filter((line) => {
      if (line.includes("call createFile") && !tools.has("createFile")) {
        return false;
      }

      if (
        line.startsWith("To update an existing document") &&
        !tools.has("updateDocument")
      ) {
        return false;
      }

      if (line.startsWith("grep searches") && !tools.has("grep")) {
        return false;
      }

      if (
        line.startsWith("To split a pdf") &&
        !hasAny([
          "splitPdf",
          "mergePdfs",
          "splitDocument",
          "mergeDocuments",
        ])
      ) {
        return false;
      }

      if (line.startsWith("To read text that is locked") && !tools.has("ocr")) {
        return false;
      }

      if (line.startsWith("To look at any file") && !tools.has("viewFile")) {
        return false;
      }

      if (
        line.startsWith("When the user asks to download") &&
        !tools.has("downloadFile")
      ) {
        return false;
      }

      return true;
    })
    .join("\n");
}

export async function buildSelectedFilesInlineContext(input: {
  repository: WorkspaceRepository;
  selectedFileIds: string[];
}) {
  const workspaceService = createWorkspaceFileService(input.repository);
  const selectedFiles = await input.repository.getByIds(input.selectedFileIds);

  if (selectedFiles.length === 0) {
    return [
      "The user intended to share files, but no selected workspace files were found.",
      "Answer normally and mention that no file content was available.",
    ].join("\n\n");
  }

  const sections: string[] = [
    "Files attached by the user for this turn:",
    "Use the following file contents as user-provided context.",
    "If a file is binary or unreadable as text, do not invent its contents.",
  ];

  let remainingBudget = 12000;

  for (const file of selectedFiles) {
    if (remainingBudget <= 0) {
      sections.push(
        "Additional selected files were omitted because the inline context budget was reached.",
      );
      break;
    }

    if (!isTextWorkspaceFile(file) && !isDocumentWorkspaceFile(file)) {
      const mimeType = file.mimeType?.toLowerCase() ?? "";

      if (mimeType.startsWith("image/")) {
        sections.push(
          `File: ${file.displayName} (${file.id})\nThis image is already included as image input for this turn. Describe what you see directly; do not claim it is unreadable and do not ask the user to show it on screen.`,
        );
        continue;
      }

      sections.push(
        `File: ${file.displayName} (${file.id})\nThis file is binary or non-text and could not be inlined.`,
      );
      continue;
    }

    try {
      const text = await workspaceService.readWorkspaceFileText(file);
      const sliceLength = Math.min(remainingBudget, 6000);
      const excerpt = text.slice(0, sliceLength);
      remainingBudget -= excerpt.length;

      sections.push(
        [
          `File: ${file.displayName} (${file.id})`,
          "Content:",
          "```",
          excerpt,
          text.length > excerpt.length ? "\n[truncated]" : "",
          "```",
        ].join("\n"),
      );
    } catch (error) {
      sections.push(
        `File: ${file.displayName} (${file.id})\nThe file could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return sections.join("\n\n");
}
