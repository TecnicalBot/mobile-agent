#!/usr/bin/env node
/**
 * Claude Code launcher for the shared ACP bridge.
 *
 * The agent is @agentclientprotocol/claude-agent-acp. It uses the Claude Code
 * login on this host, so a claude.ai subscription works without the app ever
 * receiving an Anthropic credential.
 */

import { CLAUDE_PROFILE, runBridge } from "../acp-bridge/bridge.mjs";

runBridge(CLAUDE_PROFILE);
