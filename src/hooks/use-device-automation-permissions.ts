import { useEffect, useState } from "react";
import {
  isAccessibilityEnabled,
  isAccessibilityPermissionGranted,
  isScreenCaptureActive,
} from "device-automation";

import type { DeviceToolPermissions } from "@/modules/config/built-in-tools";

export function useDeviceAutomationPermissions(): DeviceToolPermissions {
  const [permissions, setPermissions] = useState<DeviceToolPermissions>({
    accessibilityEnabled: false,
    accessibilityPermissionGranted: false,
    screenCaptureActive: false,
  });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [accessibility, accessibilityPermission, screenCapture] =
        await Promise.all([
          isAccessibilityEnabled(),
          isAccessibilityPermissionGranted(),
          isScreenCaptureActive(),
        ]);
      if (!active) return;
      setPermissions({
        accessibilityEnabled: accessibility,
        accessibilityPermissionGranted: accessibilityPermission,
        screenCaptureActive: screenCapture,
      });
    };

    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return permissions;
}
