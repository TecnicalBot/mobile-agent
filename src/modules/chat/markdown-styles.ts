import { StyleSheet } from "react-native";

import { CHAT_TEXT_STYLE } from "@/constants/chat-typography";

/**
 * Narrowest a column gets before a table starts scrolling sideways instead of
 * squeezing its text into slivers.
 */
export const TABLE_MIN_COLUMN_WIDTH = 116;

export function createMarkdownStyles(input: {
  borderColor: string;
  codeBackground: string;
  inlineCodeBackground: string;
  linkColor: string;
  mutedText: string;
  tableHeaderBackground: string;
  text: string;
}) {
  return {
    body: {
      color: input.text,
      flexShrink: 1,
      fontFamily: "System",
      ...CHAT_TEXT_STYLE,
      marginBottom: 0,
      marginTop: 0,
      maxWidth: "100%",
      width: "100%",
    },
    bullet_list: {
      marginBottom: 12,
      marginTop: 2,
    },
    bullet_list_content: {
      flex: 1,
    },
    bullet_list_icon: {
      color: input.text,
      marginRight: 8,
      width: 12,
    },
    code_block: {
      backgroundColor: input.codeBackground,
      borderRadius: 16,
      color: input.text,
      fontFamily: "monospace",
      fontSize: 14,
      lineHeight: 22,
      marginBottom: 12,
      marginTop: 6,
      padding: 12,
    },
    code_inline: {
      backgroundColor: input.inlineCodeBackground,
      borderRadius: 8,
      color: input.text,
      fontFamily: "monospace",
      fontSize: 14,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    fence: {
      backgroundColor: input.codeBackground,
      borderRadius: 16,
      color: input.text,
      fontFamily: "monospace",
      fontSize: 14,
      lineHeight: 22,
      marginBottom: 12,
      marginTop: 6,
      padding: 12,
    },
    blockquote: {
      borderColor: input.borderColor,
      borderLeftWidth: 3,
      color: input.mutedText,
      marginBottom: 12,
      marginTop: 2,
      paddingLeft: 12,
    },
    heading1: {
      color: input.text,
      fontSize: 24,
      fontWeight: "700",
      lineHeight: 32,
      marginBottom: 8,
      marginTop: 10,
    },
    heading2: {
      color: input.text,
      fontSize: 21,
      fontWeight: "700",
      lineHeight: 28,
      marginBottom: 8,
      marginTop: 10,
    },
    heading3: {
      color: input.text,
      fontSize: 18,
      fontWeight: "700",
      lineHeight: 25,
      marginBottom: 6,
      marginTop: 8,
    },
    heading4: {
      color: input.text,
      fontSize: 17,
      fontWeight: "700",
      lineHeight: 24,
      marginBottom: 6,
      marginTop: 8,
    },
    heading5: {
      color: input.text,
      fontSize: 16,
      fontWeight: "700",
      lineHeight: 23,
      marginBottom: 4,
      marginTop: 8,
    },
    heading6: {
      color: input.mutedText,
      fontSize: 15,
      fontWeight: "700",
      lineHeight: 22,
      marginBottom: 4,
      marginTop: 8,
    },
    hr: {
      backgroundColor: input.borderColor,
      height: 1,
      marginBottom: 16,
      marginTop: 16,
    },
    image: {
      marginBottom: 10,
      marginTop: 4,
    },
    link: {
      color: input.linkColor,
      textDecorationLine: "underline",
    },
    list_item: {
      alignItems: "flex-start",
      color: input.text,
      flexDirection: "row",
      justifyContent: "flex-start",
      marginBottom: 5,
      marginTop: 0,
    },
    ordered_list: {
      marginBottom: 12,
      marginTop: 2,
    },
    ordered_list_content: {
      flex: 1,
    },
    ordered_list_icon: {
      color: input.text,
      marginRight: 8,
      paddingTop: 1,
      textAlign: "right",
      width: 32,
    },
    paragraph: {
      color: input.text,
      fontSize: 16,
      lineHeight: 24,
      marginBottom: 10,
      marginTop: 0,
    },
    strong: {
      color: input.text,
      fontWeight: "700",
    },
    task_list_check: {
      color: input.codeBackground,
      fontSize: 13,
      fontWeight: "700",
      lineHeight: 15,
    },
    task_list_icon: {
      alignItems: "center",
      borderColor: input.text,
      borderRadius: 4,
      borderWidth: 1.5,
      height: 18,
      justifyContent: "center",
      marginRight: 8,
      marginTop: 2,
      width: 18,
    },
    task_list_icon_checked: {
      backgroundColor: input.text,
    },
    table: {
      borderColor: input.borderColor,
      borderLeftWidth: 1,
      borderTopWidth: 1,
    },
    td: {
      borderColor: input.borderColor,
      borderRightWidth: 1,
      color: input.text,
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      minWidth: TABLE_MIN_COLUMN_WIDTH,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    th: {
      backgroundColor: input.tableHeaderBackground,
      borderColor: input.borderColor,
      borderRightWidth: 1,
      color: input.text,
      flex: 1,
      fontSize: 14,
      fontWeight: "700",
      lineHeight: 20,
      minWidth: TABLE_MIN_COLUMN_WIDTH,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    tr: {
      borderBottomWidth: 1,
      borderColor: input.borderColor,
      flexDirection: "row",
    },
  } satisfies StyleSheet.NamedStyles<any>;
}

export type ChatMarkdownStyles = ReturnType<typeof createMarkdownStyles>;
