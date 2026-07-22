import { Redirect } from "expo-router";

export default function McpIndexScreen() {
  return <Redirect href={"/settings/mcp/connected" as never} />;
}
