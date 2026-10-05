import { Redirect } from "expo-router";

export default function PluginsIndexScreen() {
  return <Redirect href={"/settings/plugins/connected" as never} />;
}
