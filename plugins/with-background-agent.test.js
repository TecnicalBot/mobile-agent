import { describe, expect, it } from "vitest";
import plugin from "./with-background-agent";

const { addPermissionsAndService } = plugin;

const SERVICE = "expo.modules.backgroundagentservice.BackgroundAgentService";
const RECEIVER = "expo.modules.backgroundagentservice.BackgroundAgentActionReceiver";

function manifest(serviceType = "dataSync") {
  return {
    manifest: {
      "uses-permission": [
        {
          $: {
            "android:name": "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
          },
        },
      ],
      application: [
        {
          service: [
            {
              $: {
                "android:name": SERVICE,
                "android:foregroundServiceType": serviceType,
                "android:exported": "false",
              },
            },
          ],
          receiver: [],
        },
      ],
    },
  };
}

function permissionNames(manifest) {
  return manifest.manifest["uses-permission"].map(
    (permission) => permission.$["android:name"],
  );
}

describe("with-background-agent", () => {
  it("declares the connectedDevice type that the service starts with", () => {
    const result = addPermissionsAndService(manifest());
    const service = result.manifest.application[0].service.find(
      (entry) => entry.$["android:name"] === SERVICE,
    );

    // The runtime calls startForeground with this exact type. A manifest that
    // still declares dataSync crashes the app with IllegalArgumentException.
    expect(service.$["android:foregroundServiceType"]).toBe("connectedDevice");
    expect(permissionNames(result)).toContain(
      "android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE",
    );
    expect(permissionNames(result)).toContain(
      "android.permission.CHANGE_WIFI_STATE",
    );
  });

  it("adds the approval receiver and stays idempotent", () => {
    const result = addPermissionsAndService(
      addPermissionsAndService(manifest("connectedDevice")),
    );
    const receivers = result.manifest.application[0].receiver;

    expect(
      receivers.filter((entry) => entry.$["android:name"] === RECEIVER),
    ).toHaveLength(1);
    expect(
      permissionNames(result).filter(
        (name) => name === "android.permission.CHANGE_WIFI_STATE",
      ),
    ).toHaveLength(1);
    expect(
      permissionNames(result).filter(
        (name) => name === "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
      ),
    ).toHaveLength(1);
  });

  it("adds the service when the manifest does not declare it", () => {
    const result = addPermissionsAndService({
      manifest: { "uses-permission": [], application: [{}] },
    });

    expect(result.manifest.application[0].service).toEqual([
      {
        $: {
          "android:name": SERVICE,
          "android:foregroundServiceType": "connectedDevice",
          "android:exported": "false",
        },
      },
    ]);
  });
});
