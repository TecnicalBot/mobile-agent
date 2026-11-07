#!/usr/bin/env node
/**
 * Start every ACP harness bridge with one command.
 *
 * This is a thin wrapper around the single-file bridge so the repo and a
 * downloaded copy behave the same:
 *
 *   node tools/start-bridges.mjs --lan --pair
 *   npm run bridges -- --lan --pair
 */

import { runAllBridges } from "./acp-bridge/bridge.mjs";

runAllBridges(process.argv.slice(2));
