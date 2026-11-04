import { VIDEO_CLIP_TIMELINE_SCRIPT } from "@/modules/preview/video-clip-timeline";
import { VIDEO_CHROMA_KEY_SCRIPT } from "@/modules/preview/video-chroma-key";

/**
 * In-page scene preview runner for the `previewScene` tool.
 *
 * The tool loads the agent's scene (assets already inlined) wrapped in this
 * script in a hidden host WebView. The script waits for media readiness,
 * calls `render(t, ...)` at each requested timestamp with silent stub audio
 * and speech objects (scenes check `.ready` first, so they draw their
 * no-audio state), captures the canvas via `toDataURL`, and posts each frame
 * back. Two render passes per timestamp let seek-chasing scenes settle: the
 * first triggers async seeks/decodes, the second paints the settled frame.
 *
 * Approximate by design (async media, no audio playback) — the render is
 * truth. A tainted canvas fails capture here first, before export time.
 *
 * Plain ES5 string (no backticks, template markers, or backslashes) like the
 * recorder string, and Node-testable with DOM stubs. Test-only knobs via
 * `window.__mobileAgentScenePreviewConfig = { settleMs, readyTimeoutMs }`.
 */
export const VIDEO_PREVIEW_SCRIPT = `(function () {
  var cancelled = false;
  var running = false;
  var timer = null;

  function config() {
    var cfg = window.__mobileAgentScenePreviewConfig;
    if (cfg && typeof cfg === 'object') {
      return {
        settleMs: typeof cfg.settleMs === 'number' ? cfg.settleMs : 400,
        readyTimeoutMs: typeof cfg.readyTimeoutMs === 'number' ? cfg.readyTimeoutMs : 10000
      };
    }
    return { settleMs: 400, readyTimeoutMs: 10000 };
  }

  function post(payload) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (_) {}
  }

  function zero() { return 0; }
  function emptyText() { return ''; }
  function negOne() { return -1; }
  function none() { return null; }

  function stubAudio() {
    return {
      ready: false, duration: 0, frameRate: 0, bpm: null, beats: [],
      energy: [], low: [], mid: [], high: [], onset: [],
      level: zero, lowAt: zero, midAt: zero, highAt: zero, onsetAt: zero,
      beatPulse: zero
    };
  }

  function stubSpeech() {
    return {
      ready: false, duration: 0, language: '', text: '', count: 0, segments: [],
      activeIndex: negOne, segmentAt: none, activeSegment: none,
      activeText: emptyText, progress: zero, nextStart: none
    };
  }

  function findCanvas(contract) {
    if (contract.canvasId) {
      var el = document.getElementById(contract.canvasId);
      if (el) return el;
    }
    var list = document.querySelectorAll('canvas');
    return list && list.length > 0 ? list[0] : null;
  }

  function mediaVideos() {
    var out = [];
    var list = document.querySelectorAll('video');
    for (var i = 0; i < list.length; i += 1) out.push(list[i]);
    return out;
  }

  // Resolves when every image is complete and every video can play at least
  // the current frame; unready elements are warned about once, never fatal.
  function mediaReady(timeoutMs) {
    return new Promise(function (resolve) {
      var warnings = [];
      var startedAt = Date.now();
      function poll() {
        if (cancelled) { resolve({ warnings: warnings }); return; }
        var pending = false;
        var imgs = document.images;
        for (var i = 0; i < imgs.length; i += 1) {
          var img = imgs[i];
          if (!img.complete) { pending = true; continue; }
          if (img.naturalWidth === 0 && !img.__previewWarned) {
            img.__previewWarned = true;
            warnings.push('An image failed to load; it paints nothing in the preview.');
          }
        }
        var videos = mediaVideos();
        for (var v = 0; v < videos.length; v += 1) {
          var video = videos[v];
          try {
            if (video.error && !video.__previewWarned) {
              video.__previewWarned = true;
              warnings.push('A video clip failed to load; it paints nothing in the preview.');
            } else if (!video.error && video.readyState < 2) {
              pending = true;
            }
          } catch (_) {}
        }
        if (!pending || Date.now() - startedAt > timeoutMs) {
          if (pending) warnings.push('Some media was still loading; the preview may show placeholders.');
          resolve({ warnings: warnings });
          return;
        }
        timer = setTimeout(poll, 120);
      }
      poll();
    });
  }

  function captureFrame(contract, canvas, ctx, audioApi, speechApi, t, settleMs) {
    // Clip frames must be AT t before the canvas is captured, or the still
    // verifies nothing: route the capture through the declared clip timeline
    // (or a legacy scene prepareFrame) exactly like export does. Waiting for
    // readiness alone captured whatever frame the clip happened to decode,
    // so a stale/wrong clip frame exported fine and looked verified.
    return prepareClipFrames(contract, t).then(function () {
      return renderAndCapture(contract, canvas, ctx, audioApi, speechApi, t, settleMs);
    });
  }

  // Export-time semantics for stills: declared clips are seeked and awaited;
  // a legacy scene prepareFrame runs too. Best-effort for legacy scenes
  // (previously stills never touched clip frames at all), but a declared
  // timeline failure surfaces and fails the capture — it would render blank.
  function prepareClipFrames(contract, t) {
    var clips = null;
    try {
      if (window.__mobileAgentClips && typeof window.__mobileAgentClips.attach === 'function') {
        clips = window.__mobileAgentClips.attach(contract);
      }
    } catch (error) {
      return Promise.reject(new Error('Scene clips are misconfigured: ' + String((error && error.message) || error)));
    }
    if (clips) return clips.prepareFrame(t);
    if (typeof contract.prepareFrame === 'function') {
      return Promise.resolve().then(function () { return contract.prepareFrame(t); }).catch(function () {});
    }
    return Promise.resolve();
  }

  // Declared shots own their window, exactly like export. The top-level render
  // covers gaps, so a storyboard still shows the same frame the MP4 will.
  function contractShots(contract) {
    var raw = contract && contract.shots;
    if (Object.prototype.toString.call(raw) !== '[object Array]') return null;
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var shot = raw[i];
      if (!shot || typeof shot.render !== 'function') continue;
      var start = Number(shot.start);
      var end = Number(shot.end);
      if (!isFinite(start) || !isFinite(end) || end <= start) continue;
      out.push({ start: start, end: end, render: shot.render });
    }
    if (!out.length) return null;
    out.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return out;
  }

  function renderAt(contract, shots, t, canvas, ctx, audioApi, speechApi) {
    var shot = null;
    if (shots) {
      for (var i = 0; i < shots.length; i += 1) {
        if (t >= shots[i].start && t < shots[i].end) { shot = shots[i]; break; }
      }
    }
    if (shot) shot.render(t, canvas, ctx, audioApi, speechApi);
    else if (typeof contract.render === 'function') contract.render(t, canvas, ctx, audioApi, speechApi);
    else throw new Error('No shot covers t=' + t + 's and the contract has no render() fallback.');
  }

  function renderAndCapture(contract, canvas, ctx, audioApi, speechApi, t, settleMs) {
    var shots = contractShots(contract);
    return new Promise(function (resolve) {
      try {
        renderAt(contract, shots, t, canvas, ctx, audioApi, speechApi);
      } catch (error) {
        resolve({ error: 'render(' + t + ') threw: ' + String((error && error.message) || error) });
        return;
      }
      timer = setTimeout(function () {
        if (cancelled) { resolve({ cancelled: true }); return; }
        try {
          renderAt(contract, shots, t, canvas, ctx, audioApi, speechApi);
        } catch (error) {
          resolve({ error: 'render(' + t + ') threw: ' + String((error && error.message) || error) });
          return;
        }
        var dataUrl = null;
        try {
          dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        } catch (error) {
          resolve({ error: 'Preview capture failed: the canvas is tainted by a cross-origin asset. Use workspace:// images and clips only.' });
          return;
        }
        if (!dataUrl) {
          resolve({ error: 'Preview capture produced no pixels at t=' + t + '.' });
          return;
        }
        var comma = dataUrl.indexOf(',');
        resolve({
          frame: {
            time: t,
            width: canvas.width,
            height: canvas.height,
            base64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
          }
        });
      }, settleMs);
    });
  }

  window.__startMobileAgentScenePreview = function (times) {
    if (running) return;
    running = true;
    cancelled = false;
    // Acknowledge before waiting for media so the native host can distinguish
    // a page that never loaded from one stuck rendering a frame.
    post({ type: 'mobileAgentPreviewStarted' });
    var cfg = config();
    var contract = window.MOBILE_AGENT_VIDEO;
    var contractShotsList = contract && contract.shots;
    var contractHasShots =
      Object.prototype.toString.call(contractShotsList) === '[object Array]' &&
      contractShotsList.length > 0;
    if (!contract || (typeof contract.render !== 'function' && !contractHasShots)) {
      running = false;
      post({ type: 'mobileAgentPreviewError', message: 'The HTML does not implement the window.MOBILE_AGENT_VIDEO contract.' });
      return;
    }
    var canvas = findCanvas(contract);
    if (!canvas) {
      running = false;
      post({ type: 'mobileAgentPreviewError', message: 'No canvas element was found in the scene.' });
      return;
    }
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (_) {}
    var list = Array.isArray(times) ? times : [];
    var videos = mediaVideos();
    for (var i = 0; i < videos.length; i += 1) {
      try { videos[i].muted = true; videos[i].pause(); } catch (_) {}
    }
    var audioApi = stubAudio();
    var speechApi = stubSpeech();
    mediaReady(cfg.readyTimeoutMs).then(function (media) {
      var warnings = media.warnings;
      var chain = Promise.resolve();
      for (var k = 0; k < list.length; k += 1) {
        (function (t) {
          chain = chain.then(function () {
            if (cancelled) return null;
            return captureFrame(contract, canvas, ctx, audioApi, speechApi, t, cfg.settleMs).then(function (result) {
              if (!result || result.cancelled) return null;
              if (result.error) {
                warnings.push(result.error);
                return null;
              }
              post({ type: 'mobileAgentPreviewFrame', frame: result.frame });
              return null;
            });
          });
        })(list[k]);
      }
      return chain.then(function () {
        running = false;
        if (cancelled) return null;
        post({ type: 'mobileAgentPreviewDone', warnings: warnings });
        return null;
      });
    }).catch(function (error) {
      running = false;
      if (!cancelled) post({ type: 'mobileAgentPreviewError', message: 'Scene preview failed: ' + String((error && error.message) || error) });
    });
  };

  window.__cancelMobileAgentScenePreview = function () {
    cancelled = true;
    if (timer) {
      try { clearTimeout(timer); } catch (_) {}
      timer = null;
    }
  };
})();`;

/**
 * Wraps a scene document with the preview runner, mirroring
 * `buildVideoExportDocument` (preview script only — no recorder).
 */
export function buildScenePreviewDocument(html: string): string {
  const script = `\n<script>${VIDEO_CLIP_TIMELINE_SCRIPT}</script>\n<script>${VIDEO_CHROMA_KEY_SCRIPT}</script>\n<script>${VIDEO_PREVIEW_SCRIPT}</script>\n`;
  const lower = html.toLowerCase();
  const index = lower.lastIndexOf("</body>");
  if (index === -1) return `${html}${script}`;
  return `${html.slice(0, index)}${script}${html.slice(index)}`;
}
