import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type SafFileOperationsNativeModule = {
  createEntry(
    rootUri: string,
    parentUri: string,
    name: string,
    mimeType: string | null,
    isDirectory: boolean,
  ): Promise<string>;
  relocateEntry(
    rootUri: string,
    sourceUri: string,
    sourceParentUri: string,
    destinationParentUri: string,
    destinationName: string,
  ): Promise<string>;
};

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
