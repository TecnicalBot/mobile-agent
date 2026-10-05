import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export type SafCreatedEntry = {
  uri: string;
  name: string;
};

type SafFileOperationsNativeModule = {
  saveDownload(sourceUri: string, name: string, mimeType: string): Promise<SafCreatedEntry>;
  createEntry(
    rootUri: string,
    parentUri: string,
    name: string,
    mimeType: string | null,
    isDirectory: boolean,
  ): Promise<SafCreatedEntry>;
  relocateEntry(
    rootUri: string,
    sourceUri: string,
    sourceParentUri: string,
    destinationParentUri: string,
    destinationName: string,
  ): Promise<SafCreatedEntry>;
};

export function saveDownload(sourceUri: string, name: string, mimeType: string) {
  const module = requireSafFileOperations();
  if (!module.saveDownload) {
    throw new Error("Direct downloads require an updated Android build.");
  }
  return module.saveDownload(sourceUri, name, mimeType);
}

const SafFileOperations =
  Platform.OS === "android"
    ? requireOptionalNativeModule<SafFileOperationsNativeModule>(
        "SafFileOperations",
      )
    : null;

function requireSafFileOperations() {
  if (!SafFileOperations) {
    throw new Error(
      "SAF file operations require a new Android development build.",
    );
  }

  return SafFileOperations;
}

export function createSafEntry(
  rootUri: string,
  parentUri: string,
  name: string,
  mimeType: string | null,
  isDirectory: boolean,
) {
  return requireSafFileOperations().createEntry(
    rootUri,
    parentUri,
    name,
    mimeType,
    isDirectory,
  );
}

export function relocateSafEntry(
  rootUri: string,
  sourceUri: string,
  sourceParentUri: string,
  destinationParentUri: string,
  destinationName: string,
) {
  return requireSafFileOperations().relocateEntry(
    rootUri,
    sourceUri,
    sourceParentUri,
    destinationParentUri,
    destinationName,
  );
}
