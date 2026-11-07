#!/usr/bin/env node
/**
 * Antigravity launcher for the shared ACP bridge.
 *
 * The implementation lives in ../acp-bridge/bridge.mjs so Antigravity and
 * Claude share the same transport, upload, and security behavior.
 */

import { ANTIGRAVITY_PROFILE, runBridge } from "../acp-bridge/bridge.mjs";

runBridge(ANTIGRAVITY_PROFILE);
