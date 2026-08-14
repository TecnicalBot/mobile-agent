// Custom entry point: registers the headless scheduler wake task before
// starting the normal app so the native alarm receiver can run the scheduler
// even when the app process was killed.
import "./src/modules/scheduler/headless-registration";

import "expo-router/entry";
