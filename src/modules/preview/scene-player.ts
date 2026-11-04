import { readContractAspect, readContractDuration } from "@/modules/preview/video-audio";

/**
 * In-app scene player (no render involved).
 *
 * Video scenes (`window.MOBILE_AGENT_VIDEO` with a `render(t, ...)` function)
 * are deterministic in `t`, so "playing" one is just advancing `t` and
 * re-calling `render` inside the preview WebView. This module builds the
 * injected player script plus the small pure helpers the native transport
 * bar needs. The player is always silent: scenes get stub audio/speech
 * objects (same shape as the not-ready APIs, every lookup empty), so a
 * scene that reads `audio.level(t)` cannot throw in preview.
 */

/** Scene length in seconds from the HTML, or null when not a video scene. */
export function getSceneDuration(html: string): number | null {
  const duration = readContractDuration(html);
  return duration != null && duration > 0 ? duration : null;
}

/**
 * Scene canvas aspect (width / height) from the HTML contract, or null when
 * undeclared — callers fall back to 16/9, never invent a ratio.
 */
export function getSceneAspect(html: string): number | null {
  const aspect = readContractAspect(html);
  return aspect != null && aspect > 0 ? aspect : null;
}

/** `7` -> `"0:07"`, `65.2` -> `"1:05"`. Floors; never negative. */
export function formatPlayerTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest}`;
}

/**
 * Builds the idempotent player script injected into the scene WebView. It
 * defines `window.__mobileAgentPlayer = { play, pause, seek, state }` and
 * posts `{ type: 'mobileAgentPlayerTime', t, playing, error, audioError }`
 * (throttled) back over `ReactNativeWebView.postMessage`.
 *
 * When the document carries the export engine (every preview page does), the
 * player also renders the contract's `audio` schedule live through a real
 * AudioContext — same cue scheduler the export mixes with — anchored on every
 * play/seek so sound stays glued to the scrubber. Visuals keep the stub
 * audio/speech objects, so a scene reading `audio.level(t)` stays
 * deterministic and identical to the render.
 *
 * Plain-JS string, free of backticks and `${`, in the house style of the
 * other injected engines.
 */
export const SCENE_PLAYER_MESSAGE_TYPE = "mobileAgentPlayerTime";

export function buildScenePlayerScript(): string {
  return `(function () {
  if (window.__mobileAgentPlayer) return;
  var v = window.MOBILE_AGENT_VIDEO;
  var rawShots = v && v.shots;
  var hasShots = Object.prototype.toString.call(rawShots) === '[object Array]' && rawShots.length > 0;
  if (!v || (typeof v.render !== 'function' && !hasShots)) return;
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  var duration = num(v.duration, 0);
  var fps = num(v.fps, 30);
  if (!(fps > 0)) fps = 30;
  var canvas = null;
  try {
    canvas = (v.canvasId && document.getElementById(v.canvasId)) ||
      document.querySelector('canvas');
  } catch (_) { canvas = null; }
  var ctx = null;
  try { ctx = canvas ? canvas.getContext('2d') : null; } catch (_) { ctx = null; }
  // Declared shots own their window in preview too, so scrubbing shows the
  // same frames the export will draw (and the top-level render covers gaps).
  var shots = null;
  if (hasShots) {
    shots = [];
    for (var si = 0; si < rawShots.length; si += 1) {
      var raw = rawShots[si];
      if (!raw || typeof raw.render !== 'function') continue;
      var start = Number(raw.start);
      var end = Number(raw.end);
      if (!isFinite(start) || !isFinite(end) || end <= start) continue;
      shots.push({ start: start, end: end, render: raw.render });
    }
    if (shots.length) {
      shots.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    } else {
      shots = null;
    }
  }
  function zero() { return 0; }
  function emptyText() { return ''; }
  var stubAudio = {
    ready: false, duration: 0, frameRate: 0, bpm: null, beats: [],
    energy: [], low: [], mid: [], high: [], onset: [], pitch: [], pitchConf: [],
    key: null, keyConfidence: null, tuningCents: null,
    level: zero, lowAt: zero, midAt: zero, highAt: zero, onsetAt: zero,
    pitchAt: zero, pitchConfAt: zero, beatPulse: zero
  };
  var stubSpeech = {
    ready: false, duration: 0, language: null, text: '', count: 0, segments: [],
    activeIndex: function () { return -1; },
    segmentAt: function () { return null; },
    activeSegment: function () { return null; },
    activeText: emptyText, progress: zero,
    nextStart: function () { return null; }
  };
  var state = { playing: false, t: 0, raf: 0, last: 0, lastDraw: 0, lastPost: 0, error: null };
  // Live soundtrack: the export engine is embedded in every preview page, so
  // reuse it — same cue scheduler the render mixes with. Anchored on every
  // play/seek; visuals keep the stub audio above, determinism untouched.
  var engine = null;
  try { engine = window.__mobileAgentAudioEngine || null; } catch (_) { engine = null; }
  var sp = engine && engine.readAudioSchedule ? engine.readAudioSchedule(v, duration) : null;
  var live = { ctx: null, handle: null, entries: null, decoding: false, pendingT: null, busy: false };
  var audioWarn = '';
  // Soundtrack readiness, posted to the app so it can show a loading pill:
  // file cues must be fetched and decoded (decodeAudioData) before any sound
  // can play, which takes seconds on a big soundtrack. 'none' = no file cues.
  var hasFileCues = false;
  if (sp) {
    for (var fc = 0; fc < sp.cues.length; fc += 1) {
      if (sp.cues[fc].kind === 'file') { hasFileCues = true; break; }
    }
  }
  var audioState = hasFileCues ? 'loading' : 'none';
  function setAudioState(next) {
    if (audioState === next) return;
    audioState = next;
    post(true);
  }
  function setAudioWarn(message) {
    message = String(message || '');
    if (message === audioWarn) return;
    audioWarn = message;
    post(true);
  }
  function stopLive() {
    if (live.handle && live.handle.master) {
      try { live.handle.master.disconnect(); } catch (_) {}
    }
    if (live.ctx) {
      try { live.ctx.close(); } catch (_) {}
    }
    live.ctx = null;
    live.handle = null;
  }
  function buildHandle() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { setAudioWarn('Live audio is not available on this device.'); return null; }
    var ctx = null;
    try { ctx = new Ctx(); } catch (e) { setAudioWarn('Live audio failed to start: ' + String((e && e.message) || e)); return null; }
    var master = ctx.createGain();
    master.gain.value = sp.master;
    master.connect(ctx.destination);
    var buses = engine.buildFxBuses(ctx, master, sp.fx);
    try { ctx.resume(); } catch (_) {}
    return {
      context: ctx, master: master, decoded: [], fxReverb: buses.fxReverb, fxDelay: buses.fxDelay,
      voices: 0, voiceOverflow: false, offlineBuffer: null, features: null
    };
  }
  function decodeEntries(ctx) {
    if (live.entries) return Promise.resolve(true);
    var entries = [];
    var chain = Promise.resolve();
    var hasFile = false;
    for (var i = 0; i < sp.cues.length; i += 1) {
      if (sp.cues[i].kind === 'file') hasFile = true;
    }
    if (!hasFile) {
      live.entries = entries;
      return Promise.resolve(true);
    }
    for (var k = 0; k < sp.cues.length; k += 1) {
      (function (cue) {
        if (cue.kind !== 'file') return;
        chain = chain.then(function () {
          return fetch(cue.src).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.arrayBuffer();
          }).then(function (buffer) {
            return ctx.decodeAudioData(buffer);
          }).then(function (decoded) {
            entries.push({ cue: cue, buffer: decoded });
          });
        }).catch(function () {
          setAudioWarn('An audio file in this scene could not be decoded for preview.');
        });
      })(sp.cues[k]);
    }
    return chain.then(function () {
      live.entries = entries;
      return true;
    });
  }
  function scheduleFrom(at) {
    stopLive();
    if (!sp) return;
    var handle = buildHandle();
    if (!handle) return;
    live.ctx = handle.context;
    live.handle = handle;
    for (var i = 0; i < sp.cues.length; i += 1) {
      var cue = sp.cues[i];
      var derived = engine.deriveSegmentCue(cue, at, duration);
      if (!derived) continue;
      var entry = null;
      if (cue.kind === 'file') {
        for (var j = 0; j < live.entries.length; j += 1) {
          if (live.entries[j].cue === cue) { entry = live.entries[j]; break; }
        }
        if (!entry) continue;
      }
      try { engine.scheduleAudioCue(handle, derived, handle.context.currentTime + 0.03, entry); } catch (_) {}
    }
  }
  // Decode the soundtrack once, shared by prewarm (page load) and the first
  // play press. Build the one live context first and decode on it: per-cue
  // throwaway AudioContexts would collide with the WebView's context budget
  // and leak closed handles.
  function prepareAudio() {
    if (!sp || live.entries || live.decoding) return;
    live.decoding = true;
    setAudioState('loading');
    var handle = buildHandle();
    if (!handle) { live.decoding = false; setAudioState('failed'); return; }
    live.ctx = handle.context;
    live.handle = handle;
    decodeEntries(handle.context).then(function () {
      live.decoding = false;
      setAudioState('ready');
      var at = live.pendingT;
      live.pendingT = null;
      if (state.playing) scheduleFrom(num(at, state.t));
    }).catch(function () {
      live.decoding = false;
      setAudioState('failed');
    });
  }
  function playLive(from) {
    if (!sp) return;
    if (!live.entries) {
      if (live.decoding) { live.pendingT = from; return; }
      prepareAudio();
      return;
    }
    scheduleFrom(from);
  }
  function post(force) {
    var now = Date.now();
    if (!force && now - state.lastPost < 200) return;
    state.lastPost = now;
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: '${SCENE_PLAYER_MESSAGE_TYPE}', t: Math.round(state.t * 100) / 100,
          playing: state.playing, error: state.error, audioError: audioWarn,
          audioState: audioState
        }));
      }
    } catch (_) {}
    state.error = null;
  }
  // Follow mode: keep declared clips in sync with the playhead so preview
  // shows what the export will draw. Playing clips advance themselves in
  // real time (muted, so the autoplay policy never blocks them); when drift
  // past 2.4 frames accumulates — a stall, a heavy frame, or playbackRate
  // quirks — currentTime snaps back to the timeline position the export
  // would use. Non-declared scenes are untouched.
  function followClips(t) {
    var clips = null;
    try {
      if (window.__mobileAgentClips && typeof window.__mobileAgentClips.attach === 'function') {
        clips = window.__mobileAgentClips.attach(v);
      }
    } catch (e) {
      if (!state.error) { state.error = String((e && e.message) || e); post(true); }
      return;
    }
    if (!clips || typeof clips.stateAt !== 'function') return;
    var states = clips.stateAt(t);
    var active = states.filter(function (s) { return s.active; }).map(function (s) { return s.el; });
    for (var i = 0; i < states.length; i += 1) {
      var s = states[i];
      var el = s.el;
      try {
        if (!s.active) {
          if (active.indexOf(el) >= 0) continue;
          if (!el.paused) el.pause();
          continue;
        }
        if (el.readyState >= 1 && Math.abs(el.currentTime - s.target) > 0.08) {
          el.currentTime = s.target;
        }
        if (state.playing) { if (el.paused) el.play(); }
        else if (!el.paused) el.pause();
      } catch (_) {}
    }
  }
  var preparingFrame = false;
  var pendingFrame = null;
  var frameGeneration = 0;
  function frameFailed(e) {
      state.error = String((e && e.message) || e);
      state.playing = false;
      if (state.raf) {
        try { cancelAnimationFrame(state.raf); } catch (_) {}
        state.raf = 0;
      }
      stopLive();
      post(true);
  }
  function paint(t) {
    try {
      var shot = null;
      if (shots) {
        for (var i = 0; i < shots.length; i += 1) {
          if (t >= shots[i].start && t < shots[i].end) { shot = shots[i]; break; }
        }
      }
      if (shot) shot.render(t, canvas, ctx, stubAudio, stubSpeech);
      else if (typeof v.render === 'function') v.render(t, canvas, ctx, stubAudio, stubSpeech);
    } catch (e) {
      frameFailed(e);
    }
  }
  function pumpFrame() {
    if (preparingFrame || pendingFrame === null) return;
    var request = pendingFrame;
    pendingFrame = null;
    preparingFrame = true;
    // prepareFrame owns clip seeking. Never run followClips concurrently with
    // it or start another seek before it finishes on the shared elements.
    Promise.resolve().then(function () {
      return v.prepareFrame(request.t);
    }).then(function () {
      if (request.generation === frameGeneration) paint(request.t);
    }, function (e) {
      if (request.generation === frameGeneration) {
        pendingFrame = null;
        frameFailed(e);
      }
    }).then(function () {
      preparingFrame = false;
      pumpFrame();
    });
  }
  function draw(t) {
    if (!ctx || !canvas) return;
    if (typeof v.prepareFrame === 'function') {
      // Real-time playback may outpace decoding. Keep just the latest clock
      // position instead of building an ever-growing queue of stale frames.
      pendingFrame = { t: t, generation: frameGeneration };
      pumpFrame();
      return;
    }
    followClips(t);
    paint(t);
  }
  function frame(now) {
    if (!state.playing) return;
    if (!state.last) state.last = now;
    var dt = (now - state.last) / 1000;
    state.last = now;
    if (!(dt > 0)) { state.raf = requestAnimationFrame(frame); return; }
    state.t += dt;
    if (duration > 0 && state.t >= duration) {
      state.t = duration;
      draw(state.t);
      state.playing = false;
      state.raf = 0;
      stopLive();
      post(true);
      return;
    }
    if (now - state.lastDraw >= 1000 / fps - 2) {
      state.lastDraw = now;
      draw(state.t);
    }
    post(false);
    state.raf = requestAnimationFrame(frame);
  }
  window.__mobileAgentPlayer = {
    play: function () {
      if (!ctx) return false;
      if (duration > 0 && state.t >= duration) state.t = 0;
      state.playing = true;
      state.last = 0;
      state.error = null;
      playLive(state.t);
      if (!state.raf) state.raf = requestAnimationFrame(frame);
      post(true);
      return true;
    },
    pause: function () {
      frameGeneration += 1;
      pendingFrame = null;
      state.playing = false;
      if (state.raf) {
        try { cancelAnimationFrame(state.raf); } catch (_) {}
        state.raf = 0;
      }
      stopLive();
      post(true);
    },
    seek: function (t) {
      frameGeneration += 1;
      t = num(t, 0);
      if (t < 0) t = 0;
      if (duration > 0 && t > duration) t = duration;
      state.t = t;
      state.last = 0;
      draw(t);
      if (state.playing) playLive(t);
      else stopLive();
      post(true);
    },
    state: function () {
      return { t: state.t, playing: state.playing, duration: duration, hasCanvas: !!ctx };
    }
  };
  // Prewarm: fetch and decode the soundtrack now instead of on the first play
  // press, so audio is ready when it is wanted (decodeAudioData works on a
  // suspended context; the context itself is closed/rebuilt by scheduleFrom).
  try { prepareAudio(); } catch (_) {}
})();`;
}
