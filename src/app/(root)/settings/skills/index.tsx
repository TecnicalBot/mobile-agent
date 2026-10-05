import { Redirect } from "expo-router";

export default function SkillsIndexScreen() {
  return <Redirect href={"/settings/skills/connected" as never} />;
}
