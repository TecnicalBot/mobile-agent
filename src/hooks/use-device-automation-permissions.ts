import { useEffect, useState } from "react";
import {
  isAccessibilityEnabled,
  isScreenCaptureActive,
} from "device-automation";

import type { DeviceToolPermissions } from "@/modules/config/built-in-tools";

export function useDeviceAutomationPermissions(): DeviceToolPermissions {
  const [permissions, setPermissions] = useState<DeviceToolPermissions>({
    accessibilityEnabled: false,
    screenCaptureActive: false,
  });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [accessibility, screenCapture] = await Promise.all([
        isAccessibilityEnabled(),
        isScreenCaptureActive(),
      ]);
      if (!active) return;
      setPermissions({
        accessibilityEnabled: accessibility,
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
