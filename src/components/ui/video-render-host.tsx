import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from "expo-keep-awake";
import { File, Paths } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";

import {
  normalizeVideoPlan,
  setVideoRenderStatus,
  subscribeVideoRender,
  type VideoJob,
  type VideoProbeJob,
  type VideoRenderJob,
  type VideoRenderPlan,
  type VideoRenderResult,
} from "@/modules/preview/video-render";
import { buildVideoExportDocument } from "@/modules/preview/video-recorder";
import { createSceneDocument } from "@/modules/preview/scene-document";
import { VideoExportController } from "@/modules/preview/video-export-messages";
import {
  RENDER_PAGE_SILENCE_MS,
  renderPageInactivityError,
} from "@/modules/preview/video-job-bounds";
import { getHtmlVideoExportModule } from "html-video-export";

const KEEP_AWAKE_TAG = "mobile-agent-video-render";
const EXPORT_VIEWPORT_WIDTH = 1280;
const EXPORT_VIEWPORT_HEIGHT = 720;

/**
 * Owns the hidden WebView that actually records a video. Mounted once in the
 * root layout. It subscribes to {@link subscribeVideoRender} and renders one
 * requested document at a time, resolving the tool's promise with the finished
 * MP4 (the `renderVideo` tool then persists it and hands it back to the user).
 *
 * Progress is published through {@link setVideoRenderStatus} so the active
 * assistant message can show an inline "Rendering video…" row — no floating
 * banner over the screen.
 */
export function VideoRenderHost() {
  const canRender =
    Platform.OS === "android" && getHtmlVideoExportModule() !== null;

  const [pending, setPending] = useState<VideoJob[]>([]);
  const [active, setActive] = useState(false);
  const [documentUri, setDocumentUri] = useState<string | null>(null);

  const webViewRef = useRef<WebView>(null);
  const documentRef = useRef<ReturnType<typeof createSceneDocument> | null>(null);
  const controllerRef = useRef<VideoExportController | null>(null);
  const fileRef = useRef<File | null>(null);
  const jobRef = useRef<VideoJob | null>(null);
  const settledRef = useRef<WeakSet<VideoJob>>(new WeakSet());
  const abortCleanupRef = useRef<(() => void) | null>(null);
  const keepAwakeRef = useRef(false);
  const lastPercentRef = useRef(-1);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configReceivedRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fixed per-segment costs the page's per-frame stats cannot see: job start
  // → page load end → first frame message. Attribution only (Phase-0 speed
  // work); never gates the render.
  const jobStartedAtRef = useRef(0);
  const pageLoadMsRef = useRef<number | null>(null);
  const firstFrameMsRef = useRef<number | null>(null);

  const clearRetries = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const disarmPageSilenceWatch = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const settle = useCallback(
    (
      job: VideoJob,
      outcome:
        | { type: "resolve"; result: VideoRenderResult }
        | { type: "plan"; plan: VideoRenderPlan }
        | { type: "reject"; error: Error },
    ) => {
      if (settledRef.current.has(job)) return;
      settledRef.current.add(job);
      if (outcome.type === "reject") {
        job.reject(outcome.error);
      } else if (outcome.type === "plan") {
        if (job.kind === "probe") job.resolve(outcome.plan);
      } else if (job.kind === "render") {
        job.resolve(outcome.result);
      }
    },
    [],
  );

  const cleanupFile = useCallback((file: File) => {
    try {
      file.delete();
    } catch {
      // The cache file may already be gone.
    }
  }, []);

  const releaseKeepAwake = useCallback(() => {
    if (!keepAwakeRef.current) return;
    keepAwakeRef.current = false;
    void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
  }, []);

  const abortCurrentFile = useCallback(() => {
    const file = fileRef.current;
    fileRef.current = null;
    if (file) cleanupFile(file);
  }, [cleanupFile]);

  const finishJob = useCallback(() => {
    documentRef.current?.dispose();
    documentRef.current = null;
    abortCleanupRef.current?.();
    abortCleanupRef.current = null;
    controllerRef.current = null;
    jobRef.current = null;
    lastPercentRef.current = -1;
    configReceivedRef.current = false;
    disarmPageSilenceWatch();
    clearRetries();
    setVideoRenderStatus(null);
    setDocumentUri(null);
    setActive(false);
    releaseKeepAwake();
  }, [clearRetries, disarmPageSilenceWatch, releaseKeepAwake]);

  const stopActive = useCallback(
    (error: Error) => {
      const job = jobRef.current;
      if (job) settle(job, { type: "reject", error });
      webViewRef.current?.injectJavaScript(
        "window.__cancelMobileAgentVideoExport ? (window.__cancelMobileAgentVideoExport(), true) : false;",
      );
      void controllerRef.current?.cancel();
      abortCurrentFile();
      finishJob();
    },
    [abortCurrentFile, finishJob, settle],
  );

  // The only unbounded silence in a healthy render is per-segment audio prep
  // (fetch + whole-file decode + offline render happen before the first frame
  // posts), bounded for inputs that fit renderer memory; every other gap is
  // sub-second frame posts, segment concat, or page boot. So silence itself is
  // the hang signature: no page message for the whole bound means the export
  // page is stuck, and this fails the job loud while the run stays alive.
  // The timer resets on every page message and every segment page load (see
  // handleLoadEnd), making this event-driven hang detection, not a deadline.
  const armPageSilenceWatch = useCallback(
    (job: VideoJob) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (jobRef.current !== job) return;
        const segment = job.kind === "render" ? job.segment : undefined;
        stopActive(
          renderPageInactivityError({
            progressPercent: Math.max(0, lastPercentRef.current),
            html: job.html,
            segment:
              segment && segment.length > 0
                ? `segment ${segment.offset}-${segment.offset + segment.length}s`
                : null,
          }),
        );
      }, RENDER_PAGE_SILENCE_MS);
    },
    [stopActive],
  );

  // Folds the host's fixed-cost measurements into the page's timing summary
  // so one object carries the whole per-segment attribution. Only attaches
  // when the page reported timings; a run without them keeps its result as-is.
  const attachHostTimings = useCallback((result: VideoRenderResult): VideoRenderResult => {
    const pageLoadMs = pageLoadMsRef.current;
    const firstFrameMs = firstFrameMsRef.current;
    if (!result.timings || (pageLoadMs === null && firstFrameMs === null)) return result;
    return {
      ...result,
      timings: {
        ...result.timings,
        ...(pageLoadMs === null ? {} : { pageLoadMs }),
        ...(firstFrameMs === null ? {} : { firstFrameMs }),
      },
    };
  }, []);

  // Document + origin resolve before the single setDocumentUri: the WebView
  // must load exactly once (a URI swap mid-flight would kill a started export).
  // file:// fallback keeps the data-URI clip path alive. Shared by renders and
  // probes so both surfaces open the scene the same way.
  const openSceneDocument = useCallback(
    (job: VideoJob) => {
      void (async () => {
        try {
          const document = createSceneDocument(buildVideoExportDocument(job.html));
          if (jobRef.current !== job) {
            document.dispose();
            return;
          }
          documentRef.current = document;
          let uri = document.uri;
          try {
            const { ensureAssetServer, servedCacheUrl } = await import(
              "@/modules/preview/asset-server"
            );
            const baseUrl = await ensureAssetServer();
            if (jobRef.current !== job) {
              document.dispose();
              documentRef.current = null;
              return;
            }
            if (baseUrl) uri = servedCacheUrl(baseUrl, document.uri);
          } catch {
            // Server unavailable: file:// document + data-URI clips.
          }
          if (jobRef.current !== job) {
            document.dispose();
            documentRef.current = null;
            return;
          }
          setDocumentUri(uri);
        } catch (error) {
          if (jobRef.current !== job) return;
          stopActive(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    },
    [stopActive],
  );

  const beginRender = useCallback(
    (job: VideoRenderJob) => {
      const module = getHtmlVideoExportModule();
      if (!module) {
        settle(job, {
          type: "reject",
          error: new Error("The video export module is unavailable."),
        });
        return;
      }

      abortCurrentFile();
      let file: File;
      try {
        file = new File(Paths.cache, `video-${Date.now()}.mp4`);
        file.create({ overwrite: true, intermediates: true });
      } catch (error) {
        settle(job, {
          type: "reject",
          error: new Error(
            `Video render could not create its output file: ${String(
              (error as Error)?.message ?? error,
            )}`,
          ),
        });
        return;
      }
      fileRef.current = file;
      jobRef.current = job;
      jobStartedAtRef.current = Date.now();
      pageLoadMsRef.current = null;
      firstFrameMsRef.current = null;
      lastPercentRef.current = -1;
      configReceivedRef.current = false;
      clearRetries();
      armPageSilenceWatch(job);

      const controller = new VideoExportController({
        outputPath: file.uri,
        module,
        // Segment resume: the encoder recorded by finished segments keeps the
        // whole output on one set of H.264 parameters (see render-segments).
        pinnedEncoder: job.pinnedEncoder,
        onConsumed: (id) => webViewRef.current?.injectJavaScript(
          `window.__mobileAgentExportConsumed?.(${id}); true;`,
        ),
        onProgress: (progress) => {
          job.onProgress?.(progress);
          // Native-side progress is forward motion even without page posts.
          armPageSilenceWatch(job);
          // The raw fraction is per-render; for segmented runs map it into the
          // whole video so the in-chat indicator never resets to 0 between
          // segments (`progressBase` + share * `progressSpan`).
          const visible =
            job.progressBase != null
              ? job.progressBase + progress * (job.progressSpan ?? 1)
              : progress;
          const cappedVisible = Math.min(0.99, visible);
          const percent = Math.floor(cappedVisible * 1000) / 10;
          if (percent !== lastPercentRef.current) {
            lastPercentRef.current = percent;
            setVideoRenderStatus({ finishing: false, progress: cappedVisible });
          }
        },
        onFinishing: () =>
          setVideoRenderStatus({
            finishing: true,
            progress: Math.min(0.99, (job.progressBase ?? 0) + (job.progressSpan ?? 1)),
          }),
        onResult: (result) => {
          // Ownership of the finished file moves to the caller (the renderVideo
          // tool persists it and deletes the cache copy), so do not clean it up
          // here — a queued render could race the tool's read.
          fileRef.current = null;
          settle(job, { type: "resolve", result: attachHostTimings(result) });
          finishJob();
        },
        onError: (message) => {
          settle(job, { type: "reject", error: new Error(message) });
          abortCurrentFile();
          finishJob();
        },
        onConfig: () => {
          configReceivedRef.current = true;
        },
      });
      controllerRef.current = controller;

      if (job.signal) {
        const onAbort = () =>
          stopActive(new Error("Video render was cancelled."));
        job.signal.addEventListener("abort", onAbort);
        abortCleanupRef.current = () =>
          job.signal?.removeEventListener("abort", onAbort);
      }

      openSceneDocument(job);
      setVideoRenderStatus({
        finishing: false,
        progress: job.progressBase ?? 0,
      });
      setActive(true);
      if (!keepAwakeRef.current) {
        keepAwakeRef.current = true;
        void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
      }
    },
    [abortCurrentFile, armPageSilenceWatch, attachHostTimings, clearRetries, finishJob, openSceneDocument, settle, stopActive],
  );

  /**
   * Plans a scene without recording: loads the same hidden page a render would,
   * asks it for its shot fingerprint, then tears down. It shares the render
   * queue so a probe can never run alongside an export.
   */
  const beginProbe = useCallback(
    (job: VideoProbeJob) => {
      const module = getHtmlVideoExportModule();
      if (!module) {
        settle(job, {
          type: "reject",
          error: new Error("The video export module is unavailable."),
        });
        return;
      }

      abortCurrentFile();
      jobRef.current = job;
      jobStartedAtRef.current = Date.now();
      pageLoadMsRef.current = null;
      firstFrameMsRef.current = null;
      lastPercentRef.current = -1;
      configReceivedRef.current = false;
      clearRetries();
      armPageSilenceWatch(job);

      if (job.signal) {
        const onAbort = () =>
          stopActive(new Error("Video render was cancelled."));
        job.signal.addEventListener("abort", onAbort);
        abortCleanupRef.current = () =>
          job.signal?.removeEventListener("abort", onAbort);
      }

      openSceneDocument(job);
      // A probe is invisible in chat: no progress row, no keep-awake.
      setVideoRenderStatus(null);
      setActive(true);
    },
    [abortCurrentFile, armPageSilenceWatch, clearRetries, openSceneDocument, settle, stopActive],
  );

  const beginJob = useCallback(
    (job: VideoJob) => {
      if (job.kind === "probe") beginProbe(job);
      else beginRender(job);
    },
    [beginProbe, beginRender],
  );

  // Drain the queue one render at a time.
  useEffect(() => {
    if (active || pending.length === 0) return;
    const [next, ...rest] = pending;
    setPending(rest);
    if (next.signal?.aborted) {
      settle(next, {
        type: "reject",
        error: new Error("Video render was cancelled."),
      });
      return;
    }
    beginJob(next);
  }, [active, beginJob, pending, settle]);

  // Collect render requests for as long as rendering is usable.
  useEffect(() => {
    if (!canRender) return;
    return subscribeVideoRender((job) => {
      setPending((current) => [...current, job]);
    });
  }, [canRender]);

  // Reject anything still in flight when the host goes away.
  useEffect(() => {
    return () => {
      abortCleanupRef.current?.();
      abortCleanupRef.current = null;
      documentRef.current?.dispose();
      documentRef.current = null;
      const inFlight = jobRef.current;
      if (inFlight) {
        settle(inFlight, {
          type: "reject",
          error: new Error("Video render was interrupted."),
        });
      }
      void controllerRef.current?.cancel();
      abortCurrentFile();
      disarmPageSilenceWatch();
      clearRetries();
      setVideoRenderStatus(null);
      releaseKeepAwake();
    };
  }, [abortCurrentFile, clearRetries, disarmPageSilenceWatch, releaseKeepAwake, settle]);

  const attemptStart = useCallback(
    (triesLeft: number) => {
      const job = jobRef.current;
      if (!job) return;
      // Skip retries once the page is alive — repeated start() calls are
      // harmless (running guard) but waste bridge traffic.
      if (configReceivedRef.current) return;
      const seg = job.kind === "render" ? job.segment : undefined;
      const args =
        seg && seg.length > 0 ? `${seg.offset}, ${seg.length}` : "";
      webViewRef.current?.injectJavaScript(
        `window.__startMobileAgentVideoExport ? (window.__startMobileAgentVideoExport(${args}), true) : false;`,
      );
      if (triesLeft > 0) {
        retryTimerRef.current = setTimeout(
          () => attemptStart(triesLeft - 1),
          200,
        );
      }
    },
    [],
  );

  const handleRenderProcessGone = useCallback(
    (event: { nativeEvent: { didCrash?: boolean } }) => {
      const job = jobRef.current;
      if (!job) return;
      const crashed = event.nativeEvent.didCrash === true;
      stopActive(
        new Error(
          crashed
            ? "Video render failed: the page renderer crashed (likely out of memory from large inlined clips). Try a smaller clip, lower resolution, or shorter duration."
            : "Video render failed: the page renderer was killed. Try a smaller clip, lower resolution, or shorter duration.",
        ),
      );
    },
    [stopActive],
  );

  const handleWebViewError = useCallback(() => {
    const job = jobRef.current;
    if (!job || configReceivedRef.current) return;
    stopActive(
      new Error(
        "Video render failed: the page could not load. Try a smaller document or shorter duration.",
      ),
    );
  }, [stopActive]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    let parsed: { type?: unknown; [key: string]: unknown } | null = null;
    try {
      parsed = JSON.parse(event.nativeEvent.data) as {
        type?: unknown;
        [key: string]: unknown;
      };
    } catch {
      // Non-JSON posts cannot be frames or plans; keep listening.
    }
    const job = jobRef.current;
    if (job?.kind === "probe") {
      if (parsed && parsed.type === "mobileAgentVideoPlan") {
        const plan = normalizeVideoPlan(parsed);
        if (plan) {
          settle(job, { type: "plan", plan });
        } else {
          settle(job, {
            type: "reject",
            error: new Error("The scene returned an invalid render plan."),
          });
        }
        finishJob();
        return;
      }
      if (parsed && parsed.type === "mobileAgentVideoError") {
        settle(job, {
          type: "reject",
          error: new Error(
            typeof parsed.message === "string" && parsed.message
              ? parsed.message
              : "Video planning failed.",
          ),
        });
        finishJob();
        return;
      }
      if (parsed && parsed.type === "mobileAgentVideoUnsupported") {
        settle(job, {
          type: "reject",
          error: new Error(
            "This HTML cannot be exported as a video: it needs a canvas and a window.MOBILE_AGENT_VIDEO contract. Ask the agent to make a recordable video.",
          ),
        });
        finishJob();
        return;
      }
      // Any page post is proof of life; push the stall bound out again.
      armPageSilenceWatch(job);
      return;
    }
    if (firstFrameMsRef.current === null && parsed && parsed.type === "mobileAgentVideoFrame") {
      firstFrameMsRef.current = Date.now() - jobStartedAtRef.current;
    }
    void controllerRef.current?.handleMessage(event);
    // Any page post is proof of life; push the stall bound out again.
    if (job) armPageSilenceWatch(job);
  }, [armPageSilenceWatch, finishJob, settle]);

  const handleLoadEnd = useCallback(() => {
    if (pageLoadMsRef.current === null) {
      pageLoadMsRef.current = Date.now() - jobStartedAtRef.current;
    }
    const job = jobRef.current;
    if (job?.kind === "probe") {
      webViewRef.current?.injectJavaScript(
        "window.__probeMobileAgentVideo ? (window.__probeMobileAgentVideo(), true) : false;",
      );
      armPageSilenceWatch(job);
      return;
    }
    attemptStart(8);
    if (job) armPageSilenceWatch(job);
  }, [armPageSilenceWatch, attemptStart]);

  if (!canRender) return null;

  return documentUri ? (
    <View
      pointerEvents="none"
      style={{
        backgroundColor: "transparent",
        height: EXPORT_VIEWPORT_HEIGHT,
        left: 0,
        opacity: 0.01,
        position: "absolute",
        top: 0,
        width: EXPORT_VIEWPORT_WIDTH,
      }}
    >
      <WebView
        ref={webViewRef}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowFileAccess
        originWhitelist={["file://*", "http://*", "https://*"]}
        onLoadEnd={handleLoadEnd}
        onMessage={handleMessage}
        onError={handleWebViewError}
        onHttpError={handleWebViewError}
        onRenderProcessGone={handleRenderProcessGone}
        source={{ uri: documentUri }}
        style={{ backgroundColor: "transparent", flex: 1 }}
      />
    </View>
  ) : null;
}
