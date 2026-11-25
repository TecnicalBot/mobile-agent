import {
    Download,
    Monitor,
    Smartphone,
    X,
    Code,
    Eye,
} from "lucide-react-native";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type MutableRefObject,
} from "react";
import {
    ActivityIndicator,
    Alert,
    type LayoutChangeEvent,
    Platform,
    Pressable,
    Text,
    useWindowDimensions,
    View,
    type ViewProps,
} from "react-native";
import { File } from "expo-file-system";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useSQLiteContext } from "expo-sqlite";
import { captureViewToTmpFile, isBlankCapture } from "@/modules/preview/view-shot";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerFooter,
    DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ScenePlayerChrome } from "@/components/ui/scene-player-chrome";
import { SceneExportOverlay } from "@/components/ui/scene-export-overlay";
import { sceneExportPresentation, type SceneExportPhase } from "@/modules/preview/scene-export-layout";
import { createDrizzleDb } from "@/core/db/repositories/shared";
import { createConfigRepository } from "@/core/db/repositories/config-repository";
import { createWorkspaceRepository } from "@/core/db/repositories/workspace-repository";
import {
    hasWorkspaceRefs,
    inlineAudioAssets,
    inlineImageAssets,
    inlineVideoAssets,
} from "@/modules/preview/video-assets";
import { useTheme } from "@/hooks/use-theme";
import { downloadFile, downloadText } from "@/core/services/download-service";
import { buildCodeDocument } from "@/modules/preview/code-document";
import { withDesktopPreviewViewport } from "@/modules/preview/html-document";
import { createSceneDocument } from "@/modules/preview/scene-document";
import {
    buildScenePlayerScript,
    getSceneAspect,
    getSceneDuration,
    SCENE_PLAYER_MESSAGE_TYPE,
} from "@/modules/preview/scene-player";
import {
    handlePreviewDownloadMessage,
    PREVIEW_DOWNLOAD_HOOK,
} from "@/modules/preview/preview-downloads";
import { hashDocumentKey } from "@/modules/preview/render-segments";
import { renderVideoWithResolvedBackend } from "@/modules/preview/render-backend-resolution";
import { buildVideoExportDocument } from "@/modules/preview/video-recorder";
import {
    getVideoRenderStatus,
    subscribeVideoRenderStatus,
} from "@/modules/preview/video-render";
import {
    VideoPlayerDialog,
    type VideoPlayerTarget,
} from "@/components/ui/video-player-dialog";
import { getHtmlVideoExportModule } from "html-video-export";

/**
 * CSS viewport width used for desktop rendering. Wide enough to trip the
 * `@media (min-width: …)` breakpoints of anything written for a laptop, which
 * is the whole point: the mobile-width web view always renders the phone
 * layout, so a responsive page cannot be checked without this.
 */
const DESKTOP_VIEWPORT_WIDTH = 1280;

/**
 * Keeps a capture busy indicator on screen long enough to be perceived. The
 * capture itself is usually faster than a single frame, so without this the
 * button would appear to do nothing.
 */
const MIN_CAPTURE_FEEDBACK_MS = 350;

type Viewport = "desktop" | "mobile";
type ViewMode = "code" | "preview";
type SceneExportState = { progress: number; status: SceneExportPhase; posterUri?: string | null; canCancel?: boolean };

/**
 * Module-scoped singleton for the manual Export. It beats the component
 * lifecycle on purpose: the render runs in the app-root hidden host (the same
 * queue the renderVideo tool uses), so minimizing or closing the preview
 * drawer must not cancel an in-flight export — the finished file still lands
 * in Downloads and the reopened drawer reattaches to the running progress
 * instead of queuing a duplicate render. That also gives the manual path the
 * same "only one render at a time" guarantee the tool path already had.
 */
type ActiveSceneExport = {
    controller: AbortController;
    state: SceneExportState;
    resultFile: File | null;
};
type SceneExportRuntime = { active: ActiveSceneExport | null; listeners: Set<() => void> };
// Fast Refresh must not lose ownership/progress of a long native export while
// polishing its UI. A module-local variable is reset when this file refreshes.
const exportGlobal = globalThis as typeof globalThis & { __mobileAgentSceneExportRuntime?: SceneExportRuntime };
const exportRuntime = exportGlobal.__mobileAgentSceneExportRuntime ??= {
    active: null,
    listeners: new Set(),
};

function notifyExport() {
    for (const listener of [...exportRuntime.listeners]) listener();
}

function setExportState(state: SceneExportState) {
    if (exportRuntime.active) exportRuntime.active.state = { ...exportRuntime.active.state, ...state };
    notifyExport();
}

/** Drops the singleton, clearing the Export button back to idle. */
function releaseSceneExport(deleteResultFile: boolean) {
    const file = exportRuntime.active?.resultFile ?? null;
    const poster = exportRuntime.active?.state.posterUri;
    exportRuntime.active = null;
    notifyExport();
    if (poster) {
        try { new File(poster).delete(); } catch { /* Cache cleanup is best-effort. */ }
    }
    if (deleteResultFile && file) {
        try {
            file.delete();
        } catch {
            // The cache file may already be gone.
        }
    }
}

/** Abort in flight and drop the temp/finished file. */
function cancelSceneExport() {
    const active = exportRuntime.active;
    if (!active) return;
    exportRuntime.active = null;
    notifyExport();
    active.controller.abort();
    if (active.state.posterUri) {
        try { new File(active.state.posterUri).delete(); } catch { /* Cache cleanup is best-effort. */ }
    }
    if (active.resultFile) {
        try {
            active.resultFile.delete();
        } catch {
            // The cache file may already be gone.
        }
    }
}

function useSceneExportState(): SceneExportState | null {
    const readState = (): SceneExportState | null => {
        if (exportRuntime.active) return exportRuntime.active.state;
        // Reattach visually to an export started before this UI update, without
        // claiming ownership of an AbortController this module does not have.
        const native = getVideoRenderStatus();
        return native ? { progress: native.progress, status: "recording", canCancel: false } : null;
    };
    const [state, setState] = useState<SceneExportState | null>(
        readState,
    );
    useEffect(() => {
        const sync = () => setState(readState());
        // Reattach immediately: a mounted dialog adopts an export started before
        // this dialog (or before a minimize) even if it is already done.
        sync();
        exportRuntime.listeners.add(sync);
        const unsubscribe = subscribeVideoRenderStatus(sync);
        return () => {
            exportRuntime.listeners.delete(sync);
            unsubscribe();
        };
    }, []);
    return state;
}

/** True while any render (tool or manual) is recording — the global lock. */
function useAnyRenderBusy(): boolean {
    const [busy, setBusy] = useState(() => getVideoRenderStatus() !== null);
    useEffect(() => {
        const sync = () => setBusy(getVideoRenderStatus() !== null);
        sync();
        const unsubscribe = subscribeVideoRenderStatus(sync);
        return () => {
            unsubscribe();
        };
    }, []);
    return busy;
}

export type CodePreviewDialogProps = {
    /** Complete HTML document, as built by `buildPreviewDocument`. Omit to open straight in source (code) mode. */
    html?: string;
    /** Raw fenced code, shown when the user switches to the code view. */
    code: string;
    language: string;
    /** Which mode the dialog opens in. Defaults to "preview" when `html` is present. */
    initialMode?: ViewMode;
    /** Base name for manual video exports (a .mp4 extension is added if missing). */
    exportFileName?: string;
    onDismiss: () => void;
};

/**
 * Full-screen code/preview viewer.
 *
 * Usually you open it for a rendered markup fence, but non-markup code can
 * open straight into the highlighted source view by omitting `html`.
 */
export function CodePreviewDialog({
    html = "",
    code,
    language,
    initialMode,
    exportFileName,
    onDismiss,
}: CodePreviewDialogProps) {
    return (
        <Drawer
            dismissible
            onOpenChange={(open) => {
                if (!open) {
                    onDismiss();
                }
            }}
            open
        >
            <DrawerContent contentClassName="max-w-full" showHandle>
                <CodePreviewContent
                    code={code}
                    html={html}
                    initialMode={initialMode}
                    language={language}
                    exportFileName={exportFileName}
                    onDismiss={onDismiss}
                />
            </DrawerContent>
        </Drawer>
    );
}

/**
 * Preview body without its own modal. Render this inside an already-open
 * drawer when switching to markup content so the modal itself never
 * unmounts/remounts (which reads as a blink).
 */
export function CodePreviewContent({
    html = "",
    code,
    language,
    initialMode,
    exportFileName,
    onDismiss,
}: CodePreviewDialogProps) {
    const theme = useTheme();
    // Without markup there is nothing to preview, so the dialog opens in (and is
    // locked to) the highlighted source view.
    const canPreview = html.trim().length > 0;
    const [viewport, setViewport] = useState<Viewport>("mobile");
    const [mode, setMode] = useState<ViewMode>(
        initialMode ?? (canPreview ? "preview" : "code"),
    );
    const [frame, setFrame] = useState<{ height: number; width: number } | null>(
        null,
    );
    const [saving, setSaving] = useState(false);
    // Capture only the page frame, without the drawer controls.
    const frameRef = useRef<View>(null);
    // Capture the scene only — transport controls are siblings, never baked in.
    const sceneViewRef = useRef<View>(null);
    const desktop = viewport === "desktop";
    // Fall back to unscaled until the first layout pass reports the real frame.
    const scale =
        desktop && frame && frame.width > 0
            ? frame.width / DESKTOP_VIEWPORT_WIDTH
            : 1;
    const codeHtml = useMemo(
        () => (mode === "code" ? buildCodeDocument(code, language, theme) : ""),
        [code, language, mode, theme],
    );
    const videoExport = useSceneExportState();
    const isExporting = videoExport !== null;
    const anyRenderBusy = useAnyRenderBusy();
    // Completed export: hand the MP4 to the real player drawer (the same
    // VideoPlayerDialog the chat uses) instead of duplicating a player here.
    const [exportedPlayer, setExportedPlayer] =
        useState<VideoPlayerTarget | null>(null);
    const exportedUriRef = useRef<string | null>(null);
    useEffect(() => {
        exportedUriRef.current = exportedPlayer ? exportedPlayer.localUri : null;
    }, [exportedPlayer]);
    // The completed MP4 is a cache file backing the player drawer (the Downloads
    // copy is independent), so drop it when the player drawer goes away or when
    // the preview dialog unmounts without ever opening it.
    useEffect(() => {
        return () => {
            const uri = exportedUriRef.current;
            if (uri) {
                try {
                    new File(uri).delete();
                } catch {
                    // The cache file may already be gone.
                }
            }
            exportedUriRef.current = null;
        };
    }, []);
    // Video-scene player (play/pause/seek without rendering). Only video
    // scenes — HTML defining window.MOBILE_AGENT_VIDEO — get the transport
    // bar, the render button, and the silent-preview treatment; plain HTML
    // keeps today's UI (viewport toggle, download) untouched.
    const sceneDuration = useMemo(() => getSceneDuration(html), [html]);
    const isVideoScene = sceneDuration != null;
    const sqlite = useSQLiteContext();
    const workspaceRepository = useMemo(
        () => createWorkspaceRepository(createDrizzleDb(sqlite)),
        [sqlite],
    );
    const configRepository = useMemo(
        () => createConfigRepository(createDrizzleDb(sqlite)),
        [sqlite],
    );
    // The export records the page as loaded: workspace:// refs must be inlined
    // first (audio, images, clips — same order as the renderVideo tool), or the
    // media silently goes missing from the MP4. The preview page loads the
    // preview-lane document (no native caches); the export rebuilds it in the
    // export lane below, where seek proxies and the WAV soundtrack are allowed
    // to cost minutes once instead of delaying every preview.
    const sceneNeedsAssets = isVideoScene && hasWorkspaceRefs(html);
    const [inlinedSceneHtml, setInlinedSceneHtml] = useState<string | null>(null);
    const [sceneAssetsError, setSceneAssetsError] = useState<string | null>(null);
    useEffect(() => {
        if (!sceneNeedsAssets) {
            setInlinedSceneHtml(null);
            setSceneAssetsError(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const { html: audioHtml } = await inlineAudioAssets(
                    html,
                    workspaceRepository,
                    "preview",
                );
                const { html: imageHtml } = await inlineImageAssets(
                    audioHtml,
                    workspaceRepository,
                );
                const { html: sceneHtml } = await inlineVideoAssets(
                    imageHtml,
                    workspaceRepository,
                    "preview",
                );
                if (!cancelled) {
                    setInlinedSceneHtml(sceneHtml);
                    setSceneAssetsError(null);
                }
            } catch (error) {
                if (!cancelled) {
                    setInlinedSceneHtml(null);
                    setSceneAssetsError(
                        error instanceof Error ? error.message : String(error),
                    );
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [html, sceneNeedsAssets, workspaceRepository]);
    const exportHtml = inlinedSceneHtml ?? html;
    const sceneAssetsPending =
        sceneNeedsAssets && inlinedSceneHtml === null && sceneAssetsError === null;
    // The preview frame hugs the scene's declared canvas ratio (width/height
    // from the contract) with a 16/9 fallback, so portrait scenes show as
    // portrait cards instead of filling the drawer.
    const sceneAspect = useMemo(
        () => getSceneAspect(exportHtml) ?? 16 / 9,
        [exportHtml],
    );
    const previewHtml = useMemo(
        () =>
            desktop
                ? withDesktopPreviewViewport(exportHtml, DESKTOP_VIEWPORT_WIDTH, scale)
                : exportHtml,
        [desktop, exportHtml, scale],
    );
    const [playerTime, setPlayerTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [playerError, setPlayerError] = useState<string | null>(null);
    const [audioError, setAudioError] = useState<string | null>(null);
    // True while the preview page is still fetching/decoding the soundtrack.
    const [audioLoading, setAudioLoading] = useState(false);
    // Fullscreen preview layer: a dedicated WebView (separate from the drawer
    // card) that snaps to the whole screen; the same message stream keeps the
    // timeline continuous across both.
    const [fullscreen, setFullscreen] = useState(false);
    const fullscreenRef = useRef(false);
    // Fullscreen mounts its own WebView; show a spinner until it finishes
    // loading so the drawer isn't a blank black screen while the page loads.
    const [modalWebViewLoaded, setModalWebViewLoaded] = useState(false);
    useEffect(() => {
        fullscreenRef.current = fullscreen;
    }, [fullscreen]);
    // Fullscreen is a landscape experience: a 16/9 scene fills a rotated screen
    // the way a native player does, instead of letterboxing into a portrait
    // frame. Lock while the fullscreen layer is open; unlocking restores the
    // app's default (app.json pins orientation to portrait, so we land there).
    useEffect(() => {
        if (fullscreen) {
            ScreenOrientation.lockAsync(
                ScreenOrientation.OrientationLock.LANDSCAPE,
            ).catch(() => {
                // OS refused the lock (e.g. multi-window) — fullscreen still
                // works, just in the current orientation.
            });
        } else {
            ScreenOrientation.unlockAsync().catch(() => {
                // Nothing to restore.
            });
            // Reset so re-entering fullscreen shows the loading spinner again
            // while the WebView remounts and reloads.
            setModalWebViewLoaded(false);
        }
        return () => {
            ScreenOrientation.unlockAsync().catch(() => {});
        };
    }, [fullscreen]);
    const modalWebViewRef = useRef<WebView>(null);
    // While the user's thumb is down, the player page keeps posting `t` (~5/s
    // while playing); without this gate the message stream yanks the thumb back
    // mid-drag. Scrubbing also pauses playback, so ticks stop at the source.
    const scrubbingRef = useRef(false);
    const scrubSeekRef = useRef({ last: 0, pending: 0 as number | null });
    const webViewRef = useRef<WebView>(null);
    // File-backed preview document: multi-MB inlined scenes exceed what
    // `source={{ html }}` can load, so the page reads from cache like the
    // hidden render/preview hosts do.
    const documentRef = useRef<ReturnType<typeof createSceneDocument> | null>(
        null,
    );
    const [documentUri, setDocumentUri] = useState<string | null>(null);
    const [loadedPreviewUri, setLoadedPreviewUri] = useState<string | null>(null);
    // While the hidden host renders, the visible preview page is blanked: its
    // clip <video> elements each hold a hardware decoder instance, and devices
    // cap concurrent codec instances per process — the encoder the render needs
    // can fail to start while the preview page holds them open (MediaCodec
    // CodecException, often error -12/ENOMEM on Samsung). Blanking the page
    // releases them; restoring the source reloads and reinstallPlayer re-anchors.
    const [previewSuspended, setPreviewSuspended] = useState(false);
    const presentation = sceneExportPresentation(videoExport?.status ?? null, previewSuspended, audioLoading);
    useEffect(() => {
        if (isExporting || previewSuspended) {
            setAudioLoading(false);
            setAudioError(null);
            setPlaying(false);
        }
    }, [isExporting, previewSuspended]);
    useEffect(() => {
        if (mode !== "preview" || !canPreview || sceneAssetsPending) {
            return;
        }
        let document: ReturnType<typeof createSceneDocument> | null = null;
        try {
            document = createSceneDocument(buildVideoExportDocument(previewHtml));
        } catch (error) {
            setPlayerError(error instanceof Error ? error.message : String(error));
            return;
        }
        documentRef.current?.dispose();
        documentRef.current = document;
        setDocumentUri(document.uri);
        return () => {
            if (documentRef.current === document) {
                documentRef.current?.dispose();
                documentRef.current = null;
            }
        };
    }, [canPreview, mode, previewHtml, sceneAssetsPending]);
    useEffect(() => {
        return () => {
            documentRef.current?.dispose();
            documentRef.current = null;
        };
    }, []);
    const canExportVideo =
        Platform.OS === "android" && getHtmlVideoExportModule() !== null;

    const playerCommand = useCallback((command: string) => {
        // Commands route to the fullscreen layer while it is open; the drawer
        // card stays paused underneath.
        const target = fullscreenRef.current
            ? modalWebViewRef.current
            : webViewRef.current;
        target?.injectJavaScript(
            `window.__mobileAgentPlayer ? (window.__mobileAgentPlayer.${command}, true) : false;`,
        );
    }, []);

    const pausePlayer = useCallback(() => {
        playerCommand("pause()");
        setPlaying(false);
    }, [playerCommand]);

    const resetPlayer = useCallback(() => {
        playerCommand("pause()");
        setPlayerTime(0);
        setPlaying(false);
        setPlayerError(null);
    }, [playerCommand]);

    const togglePlay = useCallback(() => {
        if (sceneDuration == null) return;
        if (playing) {
            pausePlayer();
            return;
        }
        setPlayerError(null);
        if (playerTime >= sceneDuration - 0.05) {
            playerCommand("seek(0)");
            setPlayerTime(0);
        }
        playerCommand("play()");
        setPlaying(true);
    }, [pausePlayer, playerCommand, playerTime, playing, sceneDuration]);

    // Preview seeks while the thumb is down are throttled (~7/s): each seek is
    // an injectJavaScript round-trip that retargets the page's canvas, so
    // flooding them per move-event janks both sides.
    const flushScrubSeek = useCallback(
        (value: number) => {
            const state = scrubSeekRef.current;
            const now = Date.now();
            if (now - state.last < 140) {
                state.pending = value;
                return;
            }
            state.last = now;
            state.pending = null;
            playerCommand(`seek(${value})`);
        },
        [playerCommand],
    );

    const handleScrubStart = useCallback(() => {
        scrubbingRef.current = true;
        scrubSeekRef.current = { last: Date.now(), pending: null };
        setPlayerError(null);
        if (playing) playerCommand("pause()");
        setPlaying(false);
    }, [playing, playerCommand]);

    const handleScrubValue = useCallback(
        (value: number) => {
            if (!Number.isFinite(value)) return;
            setPlayerTime(value);
            flushScrubSeek(value);
        },
        [flushScrubSeek],
    );

    const handleScrubComplete = useCallback(
        (value: number) => {
            scrubbingRef.current = false;
            flushScrubSeek(value);
            setPlayerTime(value);
        },
        [flushScrubSeek],
    );

    const installPlayer = useCallback(() => {
        if (exportRuntime.active || previewSuspended) return;
        webViewRef.current?.injectJavaScript(`${buildScenePlayerScript()}\ntrue;`);
    }, [previewSuspended]);
    // The fullscreen layer mounts its own WebView, so on load it installs the
    // player and snap-jumps to the timeline position the drawer card is at —
    // the two WebViews never share a page, only the shared t state.
    const installPlayerFullscreen = useCallback(() => {
        setModalWebViewLoaded(true);
        const webView = modalWebViewRef.current;
        if (!webView) return;
        webView.injectJavaScript(`${buildScenePlayerScript()}\ntrue;`);
        const t = Math.max(
            0,
            Math.min(playerTimeRef.current, sceneDurationRef.current ?? 0),
        );
        webView.injectJavaScript(
            `window.__mobileAgentPlayer ? (window.__mobileAgentPlayer.seek(${t}), true) : false;`,
        );
    }, []);
    const playerTimeRef = useRef(0);
    const sceneDurationRef = useRef<number | null>(null);
    useEffect(() => {
        playerTimeRef.current = playerTime;
        sceneDurationRef.current = sceneDuration;
    }, [playerTime, sceneDuration]);
    const previousHtml = useRef(html);

    const stopExport = useCallback(() => {
        cancelSceneExport();
    }, []);

    // The preview dialog and the renderVideo tool run the SAME pipeline:
    // renderSegments -> requestVideoRender -> the one hidden export host. One
    // queue, one native module, identical segmentation/resume/errors/warnings,
    // so a manual export and an agent render can never fight over the singleton
    // native session. The singleton export state lives at module scope, so
    // minimizing or closing this drawer never cancels the render — when it
    // completes the file lands in Downloads either way.
    const handleExportVideo = useCallback(() => {
        if (exportRuntime.active || videoExport || anyRenderBusy || mode !== "preview") return;
        if (hasWorkspaceRefs(exportHtml)) {
            Alert.alert(
                "Video export unavailable",
                sceneAssetsError ??
                "This scene references workspace files that could not be loaded here. Ask the agent to render it with renderVideo instead.",
            );
            return;
        }
        if (sceneDuration == null) return;
        // The hidden host owns the canvas while rendering; stop the visible
        // player loop first so the two never fight over the page.
        pausePlayer();
        // Drop a previously exported copy so its cache file goes with its drawer.
        if (exportedUriRef.current) {
            try {
                new File(exportedUriRef.current).delete();
            } catch {
                // Already gone.
            }
            setExportedPlayer(null);
            exportedUriRef.current = null;
        }

        const controller = new AbortController();
        const entry = {
            controller,
            state: { progress: 0, status: "preparing", posterUri: null } as SceneExportState,
            resultFile: null as File | null,
        };
        exportRuntime.active = entry;
        notifyExport();

        void (async () => {
            try {
                let posterUri: string | null = null;
                try {
                    posterUri = await captureViewToTmpFile(sceneViewRef, {
                        format: "jpg", quality: 0.8, result: "tmpfile",
                    }, "Export thumbnail");
                    if (isBlankCapture(posterUri)) {
                        try { new File(posterUri).delete(); } catch { /* Best-effort. */ }
                        posterUri = null;
                    }
                } catch {
                    // A clean dark fallback is preferable to a blank/white WebView.
                }
                if (controller.signal.aborted || exportRuntime.active !== entry) {
                    if (posterUri) {
                        try { new File(posterUri).delete(); } catch { /* Best-effort. */ }
                    }
                    return;
                }
                // The poster is now independent of the page. Unmount the preview
                // before encoding to return its hardware decoders to the pool.
                setPreviewSuspended(true);
                setAudioLoading(false);
                setAudioError(null);
                setExportState({ progress: 0, status: "preparing", posterUri });
                // Build the export lane document: all-keyframe seek proxies and
                // the WAV soundtrack are export-only. They are the difference
                // between a seek that decodes one frame and one that decodes a
                // 6 s GOP, so the preview must never be the thing that skips
                // them. Status stays "preparing" while this runs.
                const { html: audioHtml } = await inlineAudioAssets(
                    html,
                    workspaceRepository,
                    "export",
                );
                const { html: imageHtml } = await inlineImageAssets(
                    audioHtml,
                    workspaceRepository,
                );
                const { html: exportDocument } = await inlineVideoAssets(
                    imageHtml,
                    workspaceRepository,
                    "export",
                );
                if (controller.signal.aborted || exportRuntime.active !== entry) return;
                setExportState({ progress: 0, status: "recording", posterUri });
                const { result, warning: backendWarning } =
                    await renderVideoWithResolvedBackend(
                        {
                            abortSignal: controller.signal,
                            contractDuration: sceneDuration,
                            documentHtml: exportDocument,
                            sourceFileId: hashDocumentKey(exportDocument),
                            onProgress: (p) =>
                                setExportState({
                                    progress: Math.max(
                                        0,
                                        Math.min(1, p.bytesWritten / Math.max(1, p.totalBytes)),
                                    ),
                                    status: "recording",
                                }),
                        },
                        { configRepository },
                    );
                if (backendWarning) {
                    // The export still succeeded; keep the reason discoverable
                    // rather than blocking the user with an alert.
                    console.warn(backendWarning);
                }
                if (controller.signal.aborted) return;
                // Keep the MP4 alive for the player drawer the export promotes to.
                entry.resultFile = new File(result.uri);
                setExportState({ progress: 1, status: "finishing" });
                const saved = await downloadFile(
                    result.uri,
                    exportVideoName(exportFileName),
                    "video/mp4",
                );
                if (!saved)
                    throw new Error("The video could not be saved to Downloads.");
                // Done: swap the blurred fake player for the real player drawer.
                setExportedPlayer({
                    displayName: saved.name,
                    localUri: result.uri,
                    mimeType: "video/mp4",
                });
            } catch (error) {
                if (!controller.signal.aborted) {
                    Alert.alert(
                        "Video export failed",
                        error instanceof Error
                            ? error.message
                            : "The video could not be exported.",
                    );
                    // The file never reached the user; drop the temp copy.
                    if (entry.resultFile) {
                        try {
                            entry.resultFile.delete();
                        } catch {
                            // Already gone.
                        }
                    }
                }
            } finally {
                // Back the button to idle once the work is over (or was cancelled —
                // cancelSceneExport already dropped the singleton in that case).
                if (exportRuntime.active === entry) releaseSceneExport(false);
                // Reload the preview page now that the encoder no longer needs the
                // codec slots (installPlayer re-runs on load end and re-anchors).
                setPreviewSuspended(false);
                notifyExport();
            }
        })();
    }, [
        anyRenderBusy,
        exportFileName,
        exportHtml,
        html,
        mode,
        pausePlayer,
        sceneAssetsError,
        sceneDuration,
        videoExport,
        workspaceRepository,
        configRepository,
    ]);

    const handleMessage = useCallback((event: WebViewMessageEvent) => {
        try {
            const payload = JSON.parse(event.nativeEvent.data) as {
                type?: unknown;
                t?: unknown;
                playing?: unknown;
                error?: unknown;
                audioError?: unknown;
                audioState?: unknown;
            } | null;
            if (
                payload &&
                typeof payload === "object" &&
                payload.type === SCENE_PLAYER_MESSAGE_TYPE
            ) {
                // Late preview readiness events are not render progress. A
                // suspended page may never finish its audio decode at all.
                if (exportRuntime.active || previewSuspended) return;
                if (scrubbingRef.current) {
                    // Ignore the page's ticking clock while the user is dragging the
                    // timeline; the scrub handlers drive the value instead.
                    return;
                }
                if (typeof payload.t === "number" && Number.isFinite(payload.t)) {
                    setPlayerTime(payload.t);
                }
                if (typeof payload.playing === "boolean") {
                    setPlaying(payload.playing);
                }
                if (typeof payload.error === "string" && payload.error) {
                    setPlayerError(payload.error);
                }
                if (typeof payload.audioError === "string") {
                    setAudioError(payload.audioError || null);
                }
                if (typeof payload.audioState === "string") {
                    setAudioLoading(payload.audioState === "loading");
                }
                return;
            }
        } catch {
            // Not a player message: fall through to the other handlers.
        }
        void handlePreviewDownloadMessage(event);
    }, [previewSuspended]);

    // A new message replaces the preview document and the player page — but the
    // in-flight export is decoupled from this WebView (it renders a snapshot of
    // the exported HTML in the hidden host), so it keeps running.
    useEffect(() => {
        if (previousHtml.current === html) return;
        previousHtml.current = html;
        resetPlayer();
    }, [html, resetPlayer]);

    // Leaving preview mode tears down the player page.
    useEffect(() => {
        if (mode === "preview") return;
        resetPlayer();
    }, [mode, resetPlayer]);

    // The export outlives this drawer by design (module-scoped pipeline + hidden
    // host), so unmount must not cancel it — only the preview player stops.
    useEffect(() => {
        return () => {
            playerCommand("pause()");
        };
    }, [playerCommand]);

    const handleSave = useCallback(async () => {
        if (saving || !frameRef.current) {
            return;
        }

        setSaving(true);
        const startedAt = Date.now();

        try {
            if (mode === "code") {
                const extension = ["html", "htm", "svg", "xml"].includes(
                    language.toLowerCase(),
                )
                    ? language.toLowerCase()
                    : "txt";
                const name = `code-${Date.now()}.${extension}`;
                const mimeType =
                    extension === "svg"
                        ? "image/svg+xml"
                        : extension === "xml"
                            ? "application/xml"
                            : extension === "txt"
                                ? "text/plain"
                                : "text/html";
                const result = await downloadText(code, name, mimeType);
                if (result)
                    Alert.alert(
                        "Code saved",
                        `${result.name} has been saved to Downloads.`,
                    );
                return;
            }
            // Lazy: the TurboModule must never be resolved at import time (the root
            // layout statically imports this file) — a runtime without the native
            // module would otherwise crash the app at startup.
            const uri = await captureViewToTmpFile(
                frameRef,
                { format: "png", quality: 1, result: "tmpfile" },
                "Preview snapshots",
            );

            // Loaded lazily so expo-media-library (a native-only module) is never
            // evaluated in the node/server-manifest bundle during `export:embed`.
            const { Asset, requestPermissionsAsync } =
                await import("expo-media-library");

            const permission = await requestPermissionsAsync(true);

            if (!permission.granted) {
                Alert.alert(
                    "Permission required",
                    "Please allow photo access to save this image.",
                );
                return;
            }

            await Asset.create(uri);

            Alert.alert("Image saved", "The preview has been saved to your gallery.");
        } catch (error) {
            Alert.alert(
                "Download failed",
                error instanceof Error ? error.message : "Failed to save the file.",
            );
        } finally {
            // Hold the spinner long enough to be seen, otherwise the button appears
            // inert and users tap it repeatedly.
            const elapsed = Date.now() - startedAt;

            if (elapsed < MIN_CAPTURE_FEEDBACK_MS) {
                await new Promise((resolve) => {
                    setTimeout(resolve, MIN_CAPTURE_FEEDBACK_MS - elapsed);
                });
            }

            setSaving(false);
        }
    }, [code, language, mode, saving]);

    const handleLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
        const { height, width } = nativeEvent.layout;
        setFrame((previous) =>
            previous && previous.width === width && previous.height === height
                ? previous
                : { height, width },
        );
    }, []);

    /**
     * Size the scene card to fit the drawer body while keeping the scene's
     * canvas ratio: width-led, height-constrained for tall/portrait scenes.
     * The leftover drawer space stays background — empty space around a
     * correctly-shaped card, never inside one.
     */
    const fittedFrame = useMemo(() => {
        if (!frame || frame.width <= 0 || frame.height <= 0) {
            return null;
        }
        let width = frame.width;
        let height = width / sceneAspect;
        if (height > frame.height) {
            height = frame.height;
            width = height * sceneAspect;
        }
        return { height, width };
    }, [frame, sceneAspect]);

    // Fullscreen letterboxes like a native player: fit the scene's declared
    // ratio into the (landscape) window and center it on black, instead of
    // stretching the WebView edge-to-edge. Recomputed on rotation since the
    // window dimensions change.
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const fullscreenFrame = useMemo(() => {
        let width = windowWidth;
        let height = width / sceneAspect;
        if (height > windowHeight) {
            height = windowHeight;
            width = height * sceneAspect;
        }
        return { height, width };
    }, [windowWidth, windowHeight, sceneAspect]);

    return (
        <>
            {/* Declarative status-bar control: hidden only while the fullscreen
                layer is open. A mounted <StatusBar> wins over the imperative
                setHidden() call, which react-native-screens can override. */}
            <StatusBar hidden={fullscreen} animated />
            <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1 gap-1">
                    <DrawerTitle>Preview</DrawerTitle>
                    <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        {language.toUpperCase()} ·{" "}
                        {mode === "code"
                            ? "Source"
                            : desktop
                                ? `${DESKTOP_VIEWPORT_WIDTH}px desktop viewport`
                                : "Fits your screen"}
                    </Text>
                </View>
                {canPreview ? (
                    <ViewModeToggle
                        value={mode}
                        onChange={setMode}
                        disabled={saving || videoExport !== null}
                    />
                ) : null}
                {isVideoScene && mode === "preview" ? null : (
                    <SavePreviewButton
                        mode={mode}
                        disabled={saving || videoExport !== null || !frame}
                        onPress={handleSave}
                        saving={saving}
                    />
                )}
                <DrawerClose asChild>
                    <Pressable
                        accessibilityLabel="Close preview"
                        className="h-11 w-11 items-center justify-center rounded-full bg-card dark:bg-card-dark"
                    >
                        <X color={theme.text} size={20} />
                    </Pressable>
                </DrawerClose>
            </View>
            {mode === "preview" && !isVideoScene ? (
                <ViewportToggle value={viewport} onChange={setViewport} />
            ) : null}
            {/*
          `flex-1` with a zero basis, so this frame's size comes from the drawer
          and never from the page inside it. That keeps the measured width — and
          therefore the desktop scale — independent of what is being rendered.
          For video scenes it only measures: the card itself hugs the scene's
          canvas ratio, centered, so empty drawer space stays outside the card.
        */}
            <View
                className={
                    mode === "preview" && isVideoScene
                        ? "min-h-0 flex-1 items-center justify-start"
                        : "min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card dark:border-border-dark dark:bg-card-dark"
                }
                onLayout={handleLayout}
                ref={frameRef}
            >
                {frame && frame.width > 0 && frame.height > 0 ? (
                    mode === "code" ? (
                        <WebView
                            key="source"
                            javaScriptEnabled={false}
                            originWhitelist={["about:blank"]}
                            scrollEnabled
                            nestedScrollEnabled
                            showsHorizontalScrollIndicator
                            showsVerticalScrollIndicator
                            source={{ html: codeHtml }}
                            style={{ backgroundColor: theme.backgroundElement, flex: 1 }}
                        />
                    ) : isVideoScene && fittedFrame ? (
                        <View
                            key={videoExport && videoExport.status !== "preparing" ? "export-card" : "preview-card"}
                            className={videoExport
                                ? "overflow-hidden rounded-card bg-black"
                                : "overflow-hidden rounded-card border border-border bg-black dark:border-border-dark"}
                            style={{
                                height: fittedFrame.height,
                                width: fittedFrame.width,
                            }}
                        >
                            {presentation.showLivePreview && documentUri ? (
                                <View collapsable={false} ref={sceneViewRef} style={{ flex: 1 }}>
                                    <SceneWebViewContainer
                                        handleLoadEnd={() => {
                                            setLoadedPreviewUri(documentUri);
                                            installPlayer();
                                        }}
                                        handleMessage={handleMessage}
                                        innerRef={webViewRef}
                                        keyName={viewport}
                                        source={documentUri}
                                        style={{ flex: 1 }}
                                    />
                                </View>
                            ) : null}
                            {!videoExport && (!documentUri || sceneAssetsPending || loadedPreviewUri !== documentUri) ? (
                                <ScenePreviewLoading error={sceneAssetsError} />
                            ) : null}
                            {presentation.showPlayerChrome && documentUri && !sceneAssetsPending && loadedPreviewUri === documentUri ? (
                              <ScenePlayerChrome
                                audioLoading={presentation.showAudioLoading}
                                duration={sceneDuration}
                                fullscreen={false}
                                onSeek={handleScrubValue}
                                onScrubComplete={handleScrubComplete}
                                onScrubStart={handleScrubStart}
                                onToggleFullscreen={() => {
                                    // The fullscreen layer owns playback from here on.
                                    pausePlayer();
                                    setFullscreen(true);
                                }}
                                onTogglePlay={togglePlay}
                                playing={playing}
                                time={playerTime}
                              />
                            ) : null}
                            {videoExport ? (
                                <SceneExportOverlay
                                    phase={videoExport.status}
                                    progress={videoExport.progress}
                                    posterUri={videoExport.posterUri}
                                />
                            ) : null}
                        </View>
                    ) : (
                        <View style={{ flex: 1 }}>
                            <WebView
                                key={viewport}
                                ref={webViewRef}
                                allowFileAccess
                                allowsInlineMediaPlayback
                                mediaPlaybackRequiresUserAction={false}
                                originWhitelist={["file://*", "http://*", "https://*"]}
                                scrollEnabled
                                setSupportMultipleWindows={false}
                                injectedJavaScript={PREVIEW_DOWNLOAD_HOOK}
                                onLoadEnd={installPlayer}
                                onMessage={handleMessage}
                                source={documentUri ? { uri: documentUri } : undefined}
                                style={{ backgroundColor: theme.backgroundElement, flex: 1 }}
                            />
                        </View>
                    )
                ) : mode === "preview" && isVideoScene ? (
                    <View style={{ width: "100%", aspectRatio: sceneAspect, borderRadius: 24, overflow: "hidden", backgroundColor: "#101217" }}>
                        <ScenePreviewLoading error={sceneAssetsError} />
                    </View>
                ) : null}
            </View>
            {/*
          Fullscreen preview: the same scene on the whole screen, reusing the
          app's Drawer (not a bare Modal) so it keeps the shared
          blur/overlay/animation language. It mounts its own WebView, so on
          load it installs the player and jumps to the shared timeline
          position; when it closes, the drawer card continues from there. The
          drawer is locked to landscape while open (see the orientation effect)
          so a 16/9 scene fills the rotated screen like a native player.
        */}
            <Drawer
                dismissible
                onOpenChange={(open) => {
                    if (!open) {
                        pausePlayer();
                        setFullscreen(false);
                    }
                }}
                open={
                    fullscreen &&
                    videoExport === null &&
                    isVideoScene &&
                    documentUri != null &&
                    sceneDuration != null
                }
            >
                <DrawerContent
                    bodyClassName="gap-0 bg-black p-0 dark:bg-black"
                    closeOnOverlayPress={false}
                    contentClassName="max-w-full rounded-none border-0 bg-black dark:bg-black"
                    fillsScreen
                    showHandle={false}
                >
                    {documentUri && sceneDuration != null ? (
                        <View className="flex-1 items-center justify-center bg-black">
                            <View
                                style={{
                                    height: fullscreenFrame.height,
                                    width: fullscreenFrame.width,
                                }}
                            >
                                <SceneWebViewContainer
                                    handleLoadEnd={installPlayerFullscreen}
                                    handleMessage={handleMessage}
                                    innerRef={modalWebViewRef}
                                    keyName={`fullscreen-${viewport}`}
                                    source={documentUri}
                                    style={{ flex: 1, backgroundColor: "#000000" }}
                                />
                                {/* Chrome lives inside the letterbox frame so the
                                    scrubber/times anchor to the video edges, not the
                                    black bars flanking a ratio-matched frame. */}
                                <ScenePlayerChrome
                                    audioLoading={audioLoading}
                                    duration={sceneDuration}
                                    fullscreen
                                    onSeek={handleScrubValue}
                                    onScrubComplete={handleScrubComplete}
                                    onScrubStart={handleScrubStart}
                                    onToggleFullscreen={() => {
                                        pausePlayer();
                                        setFullscreen(false);
                                    }}
                                    onTogglePlay={togglePlay}
                                    playing={playing}
                                    time={playerTime}
                                />
                            </View>
                            {/* Spinner over the still-loading WebView so the
                                edge-to-edge drawer isn't a blank black screen. */}
                            {!modalWebViewLoaded ? (
                                <View className="absolute inset-0 items-center justify-center">
                                    <ActivityIndicator color="#FFFFFF" size="large" />
                                </View>
                            ) : null}
                        </View>
                    ) : (
                        // Fullscreen drawer is edge-to-edge black; show a loading
                        // indicator while the WebView page loads so it's not blank.
                        <View className="flex-1 items-center justify-center bg-black">
                            <ActivityIndicator color="#FFFFFF" size="large" />
                        </View>
                    )}
                </DrawerContent>
            </Drawer>
            {mode === "preview" && isVideoScene && sceneDuration != null && presentation.showPlayerChrome ? (
                <View className="gap-1">
                    {playerError ? (
                        <Text className="font-sans text-xs text-red-500">
                            {playerError}
                        </Text>
                    ) : null}
                    {audioError ? (
                        <Text className="font-sans text-xs text-amber-500">
                            {audioError}
                        </Text>
                    ) : null}
                </View>
            ) : null}
            {/*
          Scene previews render in the footer like any player drawer: a
          full-width Export action (release-drawer style). While importing, the
          button itself reads "Exporting…" and tapping it (or the Cancel link
          below it) cancels the render.
        */}
            {canExportVideo && mode === "preview" && isVideoScene ? (
                <DrawerFooter className="w-full flex-row flex-wrap gap-sp-2">
                    <Button
                        className="w-full"
                        disabled={
                             videoExport
                                 ? true
                                : anyRenderBusy || sceneAssetsPending || !fittedFrame
                        }
                         onPress={handleExportVideo}
                    >
                         {videoExport?.status === "preparing" ? "Preparing…" : videoExport?.status === "finishing" ? "Saving…" : videoExport ? "Exporting…" : "Export"}
                    </Button>
                    {videoExport && videoExport.canCancel !== false ? (
                        <Pressable
                            accessibilityLabel="Cancel video export"
                            accessibilityRole="button"
                            className="w-full items-center"
                            hitSlop={8}
                            onPress={stopExport}
                            style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
                        >
                            <Text className="font-sans text-sm text-muted-foreground underline dark:text-muted-foreground-dark">
                                Cancel
                            </Text>
                        </Pressable>
                    ) : null}
                </DrawerFooter>
            ) : null}
            {/*
          When the unified pipeline finishes, the blurred fake player is
          swapped for the real player drawer — the very same
          VideoPlayerDialog the in-chat video cards open.
        */}
            <VideoPlayerDialog
                onDismiss={() => {
                    setExportedPlayer(null);
                }}
                video={exportedPlayer}
            />
        </>
    );
}

/**
 * Shared WebView mounting a scene document: the drawer card and the
 * fullscreen layer both use exactly this (same flags, same hooks), keeping
 * the preview page behavior identical on both sides.
 */
function ScenePreviewLoading({ error }: { error: string | null }) {
    return (
        <View
            accessibilityRole="progressbar"
            accessibilityLabel={error ? "Preview unavailable" : "Loading preview"}
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#101217", alignItems: "center", justifyContent: "center", padding: 20, gap: 10 }}
        >
            {error ? null : <ActivityIndicator color="#FFFFFF" />}
            <Text style={{ color: "#FFFFFF", fontSize: 12, textAlign: "center" }}>
                {error ?? "Loading preview…"}
            </Text>
        </View>
    );
}

function SceneWebViewContainer({
    handleLoadEnd,
    handleMessage,
    innerRef,
    keyName,
    source,
    style,
}: {
    handleLoadEnd: () => void;
    handleMessage: (event: WebViewMessageEvent) => void;
    innerRef: MutableRefObject<WebView | null>;
    keyName: string;
    source: string;
    style: ViewProps["style"];
}) {
    return (
        <View style={style}>
            <WebView
                key={keyName}
                ref={innerRef}
                allowFileAccess
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                originWhitelist={["file://*", "http://*", "https://*", "about:*"]}
                scrollEnabled
                setSupportMultipleWindows={false}
                injectedJavaScript={PREVIEW_DOWNLOAD_HOOK}
                onLoadEnd={handleLoadEnd}
                onMessage={handleMessage}
                source={{ uri: source }}
                style={{ flex: 1, backgroundColor: "#000000" }}
            />
        </View>
    );
}

/**
 * Names a manual export after the scene when possible so it can be found in
 * Downloads; otherwise falls back to the old timestamped name.
 */
function exportVideoName(exportFileName: string | undefined): string {
    const base = (exportFileName ?? "")
        .replace(/[/\\?%*:|"<>]/g, "_")
        .trim()
        .replace(/\.mp4$/i, "");
    const safe = base || `video-${Date.now()}`;
    return `${safe}.mp4`;
}

/**
 * Saves raw source in code mode and the visible preview to the gallery otherwise.
 * Disabled until the frame is measured to avoid capturing an empty image.
 */
function SavePreviewButton({
    mode,
    disabled,
    onPress,
    saving,
}: {
    mode: ViewMode;
    disabled: boolean;
    onPress: () => void;
    saving: boolean;
}) {
    const theme = useTheme();

    return (
        <Pressable
            accessibilityLabel={
                mode === "code" ? "Download source code" : "Save preview as image"
            }
            accessibilityRole="button"
            className="h-11 w-11 items-center justify-center rounded-full bg-card dark:bg-card-dark active:opacity-70"
            disabled={disabled}
            onPress={onPress}
            style={{ opacity: disabled && !saving ? 0.4 : 1 }}
        >
            {saving ? (
                <ActivityIndicator color={theme.text} size="small" />
            ) : (
                <Download color={theme.text} size={20} />
            )}
        </Pressable>
    );
}

function ViewModeToggle({
    value,
    onChange,
    disabled,
}: {
    value: ViewMode;
    onChange: (value: ViewMode) => void;
    disabled: boolean;
}) {
    const theme = useTheme();

    return (
        <Pressable
            accessibilityLabel={value === "preview" ? "Show code" : "Show preview"}
            accessibilityRole="button"
            className="h-11 w-11 items-center justify-center rounded-full bg-card dark:bg-card-dark active:opacity-70"
            disabled={disabled}
            onPress={() => onChange(value === "preview" ? "code" : "preview")}
        >
            {value === "preview" ? (
                <Code color={theme.text} size={20} />
            ) : (
                <Eye color={theme.text} size={20} />
            )}
        </Pressable>
    );
}

function ViewportToggle({
    value,
    onChange,
}: {
    value: Viewport;
    onChange: (value: Viewport) => void;
}) {
    const theme = useTheme();

    return (
        <View
            accessibilityRole="tablist"
            className="flex-row gap-1 overflow-hidden rounded-xl bg-card p-1 dark:bg-card-dark"
        >
            {(
                [
                    { label: "Mobile", value: "mobile" },
                    { label: "Desktop", value: "desktop" },
                ] as const
            ).map((option) => {
                const selected = value === option.value;
                return (
                    <Pressable
                        accessibilityLabel={`${option.label} view`}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        key={option.value}
                        onPress={() => {
                            onChange(option.value);
                        }}
                        className="h-11 flex-1 flex-row items-center justify-center gap-2 rounded-lg active:opacity-70"
                        style={{
                            backgroundColor: selected
                                ? theme.backgroundSelected
                                : "transparent",
                        }}
                    >
                        {option.value === "mobile" ? (
                            <Smartphone
                                color={selected ? theme.text : theme.textSecondary}
                                size={18}
                            />
                        ) : (
                            <Monitor
                                color={selected ? theme.text : theme.textSecondary}
                                size={18}
                            />
                        )}
                        <Text
                            className="font-sans text-sm font-semibold"
                            style={{ color: selected ? theme.text : theme.textSecondary }}
                        >
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}
