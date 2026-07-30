type AnchorRole = "user" | "assistant";

export interface IChatMessage {
  id: string;
  role: AnchorRole;
  text: string;
}
