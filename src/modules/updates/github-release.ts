import Constants from "expo-constants";

const RELEASES_API_URL =
  "https://api.github.com/repos/TecnicalBot/mobile-agent/releases";
const RELEASE_CACHE_TTL_MS = 60 * 60 * 1000;

export type AvailableRelease = {
  apkName: string;
  apkUrl: string;
  currentVersion: string;
  name: string;
  tagName: string;
  url: string;
};

type GitHubRelease = {
  assets?: Array<{
    browser_download_url?: string;
    name?: string;
  }>;
  draft?: boolean;
  html_url?: string;
  name?: string;
  prerelease?: boolean;
  tag_name?: string;
};

let cachedResult: {
  checkedAt: number;
  release: AvailableRelease | null;
} | null = null;
let pendingCheck: Promise<AvailableRelease | null> | null = null;

function versionParts(value: string) {
  const match = value
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/);
  return match
    ? {
        numbers: match.slice(1, 4).map(Number),
        prerelease: match[4] ?? null,
      }
    : null;
}

export function isNewerVersion(candidate: string, current: string) {
  const candidateParts = versionParts(candidate);
  const currentParts = versionParts(current);

  if (!candidateParts || !currentParts) return false;

  for (let index = 0; index < 3; index += 1) {
    if (candidateParts.numbers[index]! > currentParts.numbers[index]!) {
      return true;
    }
    if (candidateParts.numbers[index]! < currentParts.numbers[index]!) {
      return false;
    }
  }

  return currentParts.prerelease !== null && candidateParts.prerelease === null;
}

async function fetchGitHubReleaseUpdate() {
  if (
    cachedResult &&
    Date.now() - cachedResult.checkedAt < RELEASE_CACHE_TTL_MS
  ) {
    return cachedResult.release;
  }

  const currentVersion = Constants.expoConfig?.version ?? "0.0.0";
  const response = await fetch(RELEASES_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub release check failed (${response.status}).`);
  }

  const releases = (await response.json()) as GitHubRelease[];
  const published = releases.filter((release) => !release.draft);

  const selectedRelease =
    published.find((item) => !item.prerelease && findApkAsset(item) !== null) ??
    published.find((item) => item.prerelease && findApkAsset(item) !== null);
  const apk = selectedRelease ? findApkAsset(selectedRelease) : null;
  const tagName = selectedRelease?.tag_name?.trim() ?? "";
  const url = selectedRelease?.html_url?.trim() ?? "";
  const availableRelease =
    tagName && url && apk && isNewerVersion(tagName, currentVersion)
      ? {
          apkName: apk.name,
          apkUrl: apk.url,
          currentVersion,
          name: selectedRelease?.name?.trim() || tagName,
          tagName,
          url,
        }
      : null;

  cachedResult = { checkedAt: Date.now(), release: availableRelease };
  return availableRelease;
}

function findApkAsset(release: GitHubRelease) {
  const asset = release.assets?.find(
    (item) =>
      item.name?.toLowerCase().endsWith(".apk") && item.browser_download_url,
  );

  return asset?.name && asset.browser_download_url
    ? { name: asset.name, url: asset.browser_download_url }
    : null;
}

export function checkForGitHubReleaseUpdate() {
  if (!pendingCheck) {
    pendingCheck = fetchGitHubReleaseUpdate().finally(() => {
      pendingCheck = null;
    });
  }

  return pendingCheck;
}

export async function installAvailableRelease(release: AvailableRelease) {
  const { Linking, Platform } = await import("react-native");

  if (Platform.OS !== "android") {
    await Linking.openURL(release.url);
    return;
  }

  const [{ File, Paths }, IntentLauncher] = await Promise.all([
    import("expo-file-system"),
    import("expo-intent-launcher"),
  ]);
  const safeName = release.apkName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const destination = new File(Paths.cache, safeName);
  const apk = await File.downloadFileAsync(release.apkUrl, destination, {
    idempotent: true,
  });

  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: apk.contentUri,
    flags: 1,
    type: "application/vnd.android.package-archive",
  });
}
