import { VIDEO_AUDIO_ANALYSIS_SCRIPT } from "@/modules/preview/video-audio-analysis";
import { VIDEO_CLIP_TIMELINE_SCRIPT } from "@/modules/preview/video-clip-timeline";
import { VIDEO_CHROMA_KEY_SCRIPT } from "@/modules/preview/video-chroma-key";

/**
 * Recorder injected into the HTML preview document.
 *
 * The page declares `window.MOBILE_AGENT_VIDEO = { duration, fps, width,
 * height, canvasId?, render(t, canvas, ctx, audio, speech), shots?, audio?,
 * speech? }`. `shots` is an optional list of `{ id, start, end, render }`
 * story beats: each owns `[start, end)`, the top-level render covers gaps, and
 * a shot's own source text is fingerprinted separately from shared scene code
 * so a one-shot edit can reuse every other shot's cached footage. The recorder
 * drives the owning `render` once per frame at the requested FPS. When file
 * audio is present it is analyzed up front (see video-audio-analysis.ts) and the
 * resulting `audio` object is passed as the fourth argument and mirrored on
 * `window.MOBILE_AGENT_VIDEO_AUDIO`, so the visuals can react to the actual
 * soundtrack deterministically. A `speech` transcript (usually the `segments`
 * from the `transcribeAudio` tool) is normalized the same way and passed as the
 * fifth argument, mirrored on `window.MOBILE_AGENT_VIDEO_SPEECH`:
 *
 *  - Video: each frame is posted as a JPEG and encoded by native MediaCodec.
 *    The producer waits for native acknowledgement; slower devices take longer
 *    to export rather than silently dropping frames. Seeking/rendering the
 *    next frame overlaps the native encode of the current one (depth-1
 *    pipeline), but submissions stay strictly ordered.
 *  - Audio path (optional `audio` schedule): file cues (data-URI audio, inlined
 *    by the renderVideo tool) and synthesized cues are mixed in a WebAudio
 *    OfflineAudioContext, sent as continuous PCM16, AAC-encoded natively, and
 *    muxed as a second track. Requested soundtracks fail explicitly if audio
 *    cannot be rendered, rather than producing a silently incomplete export.
 *
 * `audio` is always an object (never undefined): when there is no analyzable
 * file audio, `audio.ready` is false and every lookup returns 0, so a page can
 * safely call `audio.level(t)` unconditionally. `speech` is likewise always an
 * object: without a usable transcript `speech.ready` is false, `speech.activeText(t)`
 * is "", and `speech.activeIndex(t)` is -1.
 *
 * Determinism rules for the page's `render`: everything must be a pure
 * function of `t` (seconds) — no `Math.random`, `Date.now`, or
 * `requestAnimationFrame`-driven state, since the recorder samples the canvas
 * on its own clock.
 *
 * Scenes with custom source-video timelines may provide async prepareFrame(t).
 */
export const VIDEO_EXPORT_SCRIPT = `(function () {
  if (window.__mobileAgentVideoExportScript) return;
  window.__mobileAgentVideoExportScript = true;

  var running = false;
  var cancelled = true;
  var timers = [];
  var stage = null;
  var hijackedCanvas = null;
  var saved = null;
  var activeAudio = null;
  var activeAudioApi = null;
  var activeSpeechApi = null;
  var analysis = (typeof window !== 'undefined' && window.__mobileAgentAudioAnalysis) || null;
  var consumeId = 0;
  var pendingConsume = null;

  window.__mobileAgentExportConsumed = function (id) {
    var pending = pendingConsume;
    if (!pending || pending.id !== id) return;
    pendingConsume = null;
    clearTimeout(pending.timer);
    pending.resolve();
  };

  function postAndWait(payload) {
    return new Promise(function (resolve, reject) {
      if (cancelled) { reject(new Error('Video export cancelled.')); return; }
      var id = ++consumeId;
      payload.requestId = id;
      var timer = setTimeout(function () {
        if (!pendingConsume || pendingConsume.id !== id) return;
        pendingConsume = null;
        reject(new Error('Native encoder did not acknowledge the export data within 30 seconds.'));
      }, 30000);
      pendingConsume = { id: id, timer: timer, resolve: resolve, reject: reject };
      post(payload);
    });
  }

  function post(payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    } catch (_) {}
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function parseNoteName(name) {
    if (typeof name !== 'string') return null;
    var m = /^\\s*([A-Ga-g])([#b]?)(-?\\d+)\\s*$/.exec(name);
    if (!m) return null;
    var base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
    if (base == null) return null;
    var acc = m[2] === '#' ? 1 : (m[2] === 'b' ? -1 : 0);
    var octave = parseInt(m[3], 10);
    if (isNaN(octave)) return null;
    return base + acc + (octave + 1) * 12;
  }

  function noteToFreq(value) {
    if (typeof value === 'number' && isFinite(value)) {
      if (value > 0 && value < 128) return midiToFreq(Math.round(value));
      return null;
    }
    var midi = parseNoteName(value);
    return midi == null ? null : midiToFreq(midi);
  }

  function validWave(wave, fallback) {
    if (wave === 'sine' || wave === 'square' || wave === 'triangle' || wave === 'sawtooth') return wave;
    return fallback;
  }

  function kitNum(raw, key, fallback, min, max) {
    var v = raw && typeof raw === 'object' ? raw[key] : null;
    if (v == null) return fallback;
    v = Number(v);
    if (isNaN(v)) return fallback;
    return clamp(v, min, max);
  }

  function normalizeKitPiece(raw) {
    return {
      level: kitNum(raw, 'level', 1, 0, 2),
      decay: kitNum(raw, 'decay', 1, 0.25, 4),
      tone: kitNum(raw, 'tone', 1, 0.5, 2)
    };
  }

  function normalizeKit(raw) {
    return {
      kick: normalizeKitPiece(raw && raw.kick),
      snare: normalizeKitPiece(raw && raw.snare),
      hat: normalizeKitPiece(raw && raw.hat),
      openhat: normalizeKitPiece(raw && raw.openhat),
      clap: normalizeKitPiece(raw && raw.clap)
    };
  }

  function normalizeDuckRanges(raw, duration) {
    var ranges = [];
    if (!Array.isArray(raw)) return ranges;
    for (var i = 0; i < raw.length; i += 1) {
      var r = raw[i];
      if (!r || typeof r !== 'object') continue;
      var start = Number(r.start);
      var end = Number(r.end);
      if (isNaN(start) || isNaN(end) || !(end > start)) continue;
      start = clamp(start, 0, duration);
      end = clamp(end, 0, duration);
      if (end > start) ranges.push({ start: start, end: end });
    }
    ranges.sort(function (a, b) { return a.start - b.start; });
    return ranges;
  }

  function normalizeSynth(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var kind = String(raw.kind || raw.type || 'tone').toLowerCase();
    var i, freqs, f;
    if (kind === 'tone' || kind === 'pluck' || kind === 'lead' || kind === 'bass') {
      freqs = [];
      if (Array.isArray(raw.notes)) {
        for (i = 0; i < raw.notes.length && freqs.length < 128; i += 1) {
          f = noteToFreq(raw.notes[i]);
          if (f) freqs.push(f);
        }
      }
      var single = Number(raw.freq) || 0;
      if (freqs.length === 0) {
        if (!(single >= 20 && single <= 20000)) return null;
        freqs.push(single);
      }
      return {
        kind: 'tone', freqs: freqs,
        wave: validWave(raw.wave, 'sine'),
        noteDur: clamp(Number(raw.noteDur) || 0.5, 0.05, 8),
        attack: clamp(Number(raw.attack) || 0.01, 0.001, 4),
        release: clamp(Number(raw.release) || 0.2, 0.001, 4)
      };
    }
    if (kind === 'pad' || kind === 'chord' || kind === 'strings') {
      freqs = [];
      if (Array.isArray(raw.notes)) {
        for (i = 0; i < raw.notes.length && freqs.length < 16; i += 1) {
          f = noteToFreq(raw.notes[i]);
          if (f) freqs.push(f);
        }
      }
      if (freqs.length === 0) return null;
      return {
        kind: 'pad', freqs: freqs,
        wave: validWave(raw.wave, 'triangle'),
        attack: clamp(Number(raw.attack) || 1.5, 0.05, 8),
        release: clamp(Number(raw.release) || 1.5, 0.05, 8)
      };
    }
    if (kind === 'noise' || kind === 'sweep' || kind === 'whoosh' || kind === 'wind' || kind === 'rain') {
      var filter = (raw.filter === 'highpass' || raw.filter === 'bandpass') ? raw.filter : 'lowpass';
      return {
        kind: 'noise', filter: filter,
        filterFreq: clamp(Number(raw.filterFreq) || 800, 20, 20000),
        filterEnd: raw.filterEnd == null ? null : clamp(Number(raw.filterEnd), 20, 20000),
        q: clamp(Number(raw.q) || 1, 0.1, 20),
        attack: clamp(Number(raw.attack) || 0.3, 0.001, 4),
        release: clamp(Number(raw.release) || 0.5, 0.001, 4)
      };
    }
    if (kind === 'drums' || kind === 'kit' || kind === 'beat') {
      var stepDur = Number(raw.stepDur) || 0.25;
      if (isNaN(stepDur)) stepDur = 0.25;
      stepDur = clamp(stepDur, 0.05, 2);
      var hits = [];
      var capped = false;
      if (Array.isArray(raw.steps)) {
        for (i = 0; i < raw.steps.length && !capped; i += 1) {
          var step = raw.steps[i];
          var names = Array.isArray(step) ? step : (typeof step === 'string' ? [step] : []);
          for (var k = 0; k < names.length; k += 1) {
            var hit = String(names[k] || '').toLowerCase();
            if (hit !== 'kick' && hit !== 'snare' && hit !== 'hat' && hit !== 'openhat' && hit !== 'clap') continue;
            if (hits.length >= 512) { capped = true; break; }
            hits.push({ at: i * stepDur, hit: hit });
          }
        }
      }
      if (hits.length === 0) return null;
      return { kind: 'drums', stepDur: stepDur, hits: hits, capped: capped, kit: normalizeKit(raw.kit) };
    }
    return null;
  }

  function normalizeAudioCue(raw, duration) {
    if (!raw || typeof raw !== 'object') return null;
    var cue = null;
    if (typeof raw.file === 'string' && raw.file) {
      cue = { kind: 'file', src: raw.file };
    } else if (raw.synth) {
      var synth = normalizeSynth(raw.synth);
      if (!synth) return null;
      cue = { kind: 'synth', synth: synth };
    } else {
      return null;
    }
    cue.start = clamp(Number(raw.start) || 0, 0, duration);
    var maxDur = Math.max(0, duration - cue.start);
    cue.duration = raw.duration == null ? maxDur : clamp(Number(raw.duration) || 0, 0, maxDur);
    if (!(cue.duration > 0)) return null;
    cue.volume = raw.volume == null ? 0.8 : clamp(Number(raw.volume), 0, 1);
    if (isNaN(cue.volume)) cue.volume = 0.8;
    cue.fadeIn = clamp(Number(raw.fadeIn) || 0, 0, cue.duration);
    cue.fadeOut = clamp(Number(raw.fadeOut) || 0, 0, cue.duration);
    cue.reverb = raw.reverb == null ? 0 : clamp(Number(raw.reverb), 0, 1);
    if (isNaN(cue.reverb)) cue.reverb = 0;
    cue.delay = raw.delay == null ? 0 : clamp(Number(raw.delay), 0, 1);
    if (isNaN(cue.delay)) cue.delay = 0;
    cue.duckRanges = normalizeDuckRanges(raw.duckUnder, duration);
    cue.duckAmount = raw.duckAmount == null ? 0.4 : clamp(Number(raw.duckAmount), 0, 1);
    if (isNaN(cue.duckAmount)) cue.duckAmount = 0.4;
    cue.duckAttack = raw.duckAttack == null ? 0.3 : clamp(Number(raw.duckAttack), 0.01, 4);
    if (isNaN(cue.duckAttack)) cue.duckAttack = 0.3;
    cue.duckRelease = raw.duckRelease == null ? 0.5 : clamp(Number(raw.duckRelease), 0.01, 4);
    if (isNaN(cue.duckRelease)) cue.duckRelease = 0.5;
    if (cue.kind === 'file') {
      cue.offset = Math.max(0, Number(raw.offset) || 0);
      cue.loop = raw.loop === true;
    }
    return cue;
  }

  function readAudioSchedule(contract, duration) {
    var audio = contract.audio;
    if (!audio || typeof audio !== 'object') return null;
    var tracks = audio.tracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    var master = audio.master == null ? 1 : clamp(Number(audio.master), 0, 1);
    if (isNaN(master)) master = 1;
    var cues = [];
    for (var i = 0; i < tracks.length && cues.length < 8; i += 1) {
      var cue = normalizeAudioCue(tracks[i], duration);
      if (cue) cues.push(cue);
    }
    if (cues.length === 0) return null;
    return { master: master, cues: cues, fx: readFxSchedule(audio) };
  }

  // Schedule-level effect buses: at most one shared reverb and one shared
  // echo per record. The value true selects tuned defaults; objects
  // override them.
  function readFxSchedule(audio) {
    var out = { reverb: null, delay: null };
    if (!audio || typeof audio.fx !== 'object' || !audio.fx) return out;
    var rev = audio.fx.reverb;
    if (rev === true) {
      out.reverb = { decay: 1.8 };
    } else if (rev && typeof rev === 'object') {
      var decay = rev.decay == null ? 1.8 : clamp(Number(rev.decay), 0.5, 3);
      if (isNaN(decay)) decay = 1.8;
      out.reverb = { decay: decay };
    }
    var dly = audio.fx.delay;
    if (dly === true) {
      out.delay = { time: 0.375, feedback: 0.35, mix: 0.25 };
    } else if (dly && typeof dly === 'object') {
      var time = dly.time == null ? 0.375 : clamp(Number(dly.time), 0.03, 2);
      if (isNaN(time)) time = 0.375;
      var feedback = dly.feedback == null ? 0.35 : clamp(Number(dly.feedback), 0, 0.85);
      if (isNaN(feedback)) feedback = 0.35;
      var mix = dly.mix == null ? 0.25 : clamp(Number(dly.mix), 0, 1);
      if (isNaN(mix)) mix = 0.25;
      out.delay = { time: time, feedback: feedback, mix: mix };
    }
    return out;
  }

  function mulberry32(seed) {
    var state = seed >>> 0;
    return function () {
      state |= 0; state = (state + 0x6D2B79F5) | 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function readContract() {
    var contract = window.MOBILE_AGENT_VIDEO;
    if (!contract) return null;
    // A shot-only scene has no top-level render; shots cover the timeline.
    var hasShots = Object.prototype.toString.call(contract.shots) === '[object Array]' && contract.shots.length > 0;
    if (typeof contract.render !== 'function' && !hasShots) return null;
    return contract;
  }

  // FNV-1a over a string. Used only for cache identity (shot/segment reuse),
  // never for security. Same algorithm as hashDocumentKey on the JS side.
  function fnv1a(text) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return 'h' + ('0000000' + (hash >>> 0).toString(16)).slice(-8);
  }

  // Declared shots, validated and sorted. A shot's own source text is kept on
  // the entry so the plan can fingerprint it independently of the shared code.
  // Invalid entries are skipped rather than failing a render: the top-level
  // render still covers the timeline.
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
      var source = '';
      try { source = shot.render.toString(); } catch (_) { source = ''; }
      out.push({
        id: typeof shot.id === 'string' && shot.id ? shot.id : 'shot-' + (i + 1),
        start: start,
        end: end,
        render: shot.render,
        source: source
      });
    }
    if (!out.length) return null;
    out.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return out;
  }

  // The shot owning a time, or null for a gap (the top-level render covers it).
  function shotAt(shots, t) {
    if (!shots) return null;
    for (var i = 0; i < shots.length; i += 1) {
      if (t >= shots[i].start && t < shots[i].end) return shots[i];
    }
    return null;
  }

  function resolveCanvas(contract) {
    var canvas = null;
    if (contract.canvasId) {
      var byId = document.getElementById(contract.canvasId);
      if (byId && byId.tagName === 'CANVAS') canvas = byId;
    }
    if (!canvas) {
      var list = document.querySelectorAll('canvas');
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].width > 0 || list[i].height > 0 || list[i].offsetWidth > 0) {
          canvas = list[i];
          break;
        }
      }
    }
    return canvas;
  }

  function hijackCanvas(canvas, width, height) {
    saved = {
      parent: canvas.parentNode,
      nextSibling: canvas.nextSibling,
      style: canvas.getAttribute('style'),
      className: canvas.getAttribute('class'),
      width: canvas.width,
      height: canvas.height,
    };
    hijackedCanvas = canvas;
    canvas.width = width;
    canvas.height = height;
    canvas.setAttribute('style', 'position:relative;width:auto;height:auto;max-width:100%;max-height:100%;margin:auto;display:block;background:#000;');
    stage = document.createElement('div');
    stage.id = 'mobile-agent-video-stage';
    stage.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#000;');
    stage.appendChild(canvas);
    document.body.appendChild(stage);
  }

  function restoreCanvas() {
    if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
    stage = null;
    if (hijackedCanvas && saved) {
      if (saved.nextSibling) {
        saved.parent.insertBefore(hijackedCanvas, saved.nextSibling);
      } else if (saved.parent) {
        saved.parent.appendChild(hijackedCanvas);
      }
      if (saved.style) hijackedCanvas.setAttribute('style', saved.style);
      else hijackedCanvas.removeAttribute('style');
      if (saved.className) hijackedCanvas.setAttribute('class', saved.className);
      else hijackedCanvas.removeAttribute('class');
      hijackedCanvas.width = saved.width;
      hijackedCanvas.height = saved.height;
    }
    hijackedCanvas = null;
    saved = null;
  }

  function renderFrame(contract, canvas, ctx, t, shots) {
    try {
      var videos = document.querySelectorAll('video');
      var times = [];
      for (var i = 0; i < videos.length; i += 1) times.push(videos[i].currentTime);
      // Declared shots own their window: rendering the shot (not the top-level
      // render) is what makes per-shot fingerprints match the footage. Gaps
      // fall back to the top-level render.
      var shot = shotAt(shots, t);
      if (shot) {
        shot.render(t, canvas, ctx || null, activeAudioApi || null, activeSpeechApi || null);
      } else if (typeof contract.render === 'function') {
        contract.render(t, canvas, ctx || null, activeAudioApi || null, activeSpeechApi || null);
      } else {
        throw new Error('No shot covers t=' + t.toFixed(3) + 's and the contract has no render() fallback.');
      }
      for (var v = 0; v < videos.length; v += 1) {
        if (videos[v].seeking || Math.abs(videos[v].currentTime - times[v]) > 0.0001) {
          throw new Error('render() changed a source video frame at t=' + t.toFixed(3) + 's. Do not seek or play videos inside render(); declare MOBILE_AGENT_VIDEO.clips (one window per appearance, from: 0 to restart), or seek and await decoding in prepareFrame().');
        }
      }
      return true;
    } catch (error) {
      fail(String((error && error.message) || error));
      return false;
    }
  }

  function teardown() {
    var audio = activeAudio;
    activeAudio = null;
    activeAudioApi = null;
    activeSpeechApi = null;
    try { window.MOBILE_AGENT_VIDEO_AUDIO = null; } catch (_) {}
    try { window.MOBILE_AGENT_VIDEO_SPEECH = null; } catch (_) {}
    if (audio) releaseAudio(audio);
    timers.forEach(function (timer) { clearTimeout(timer); });
    timers = [];
    if (pendingConsume) {
      var pending = pendingConsume;
      pendingConsume = null;
      clearTimeout(pending.timer);
      pending.reject(new Error('Video export stopped.'));
    }
    restoreCanvas();
    running = false;
    try { window.MOBILE_AGENT_VIDEO_RECORDING = false; } catch (_) {}
  }

  function fail(message) {
    if (cancelled) return;
    cancelled = true;
    teardown();
    post({ type: 'mobileAgentVideoError', message: message });
  }

  function cancel() {
    if (cancelled && !running) return;
    cancelled = true;
    teardown();
  }

  function releaseAudio(handle) {
    if (!handle) return;
    handle.context = null;
    handle.offlineBuffer = null;
  }

  function postAudioWarning(reason) {
    post({ type: 'mobileAgentVideoAudioWarning', reason: String(reason || 'Audio was skipped.') });
  }

  function noiseBuffer(ctx) {
    if (ctx.__mobileAgentNoise) return ctx.__mobileAgentNoise;
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    var rand = mulberry32(0xC0FFEE);
    for (var i = 0; i < len; i += 1) data[i] = rand() * 2 - 1;
    ctx.__mobileAgentNoise = buf;
    return buf;
  }

  // Schedule-wide voice budget: thousands of live nodes can stall low-end
  // devices, so sound events past the budget are skipped with a warning
  // instead of failing the render. Counts events (note/hit/voice), not nodes.
  function claimVoice(handle) {
    handle.voices = (handle.voices | 0) + 1;
    if (handle.voices > 2048) {
      handle.voiceOverflow = true;
      return false;
    }
    return true;
  }

  // Procedural reverb impulse: stereo decaying noise with a one-pole
  // darkening pass, peak-normalized to 1. Seeded, so every record renders
  // the exact same room — deterministic like the noise buffer above.
  function makeImpulse(ctx, decaySeconds) {
    var rate = ctx.sampleRate;
    var len = Math.max(1, Math.floor(rate * decaySeconds));
    var buf = ctx.createBuffer(2, len, rate);
    var rand = mulberry32(0x7E57B);
    var ch, i;
    for (ch = 0; ch < 2; ch += 1) {
      var data = buf.getChannelData(ch);
      var last = 0;
      for (i = 0; i < len; i += 1) {
        var t = i / len;
        var env = Math.pow(1 - t, 2.2);
        last = last + 0.3 * ((rand() * 2 - 1) - last);
        data[i] = last * env;
      }
    }
    var peak = 0.0001;
    for (ch = 0; ch < 2; ch += 1) {
      var scan = buf.getChannelData(ch);
      for (i = 0; i < len; i += 1) {
        var amp = scan[i] < 0 ? -scan[i] : scan[i];
        if (amp > peak) peak = amp;
      }
    }
    var inv = 1 / peak;
    for (ch = 0; ch < 2; ch += 1) {
      var norm = buf.getChannelData(ch);
      for (i = 0; i < len; i += 1) norm[i] = norm[i] * inv;
    }
    return buf;
  }

  function schedulePluck(handle, s, freq, startAt, endAt, out) {
    if (!claimVoice(handle)) return;
    var ctx = handle.context;
    var osc = ctx.createOscillator();
    osc.type = s.wave;
    osc.frequency.value = freq;
    var g = ctx.createGain();
    var peakAt = startAt + Math.min(s.attack, Math.max(0.005, (endAt - startAt) / 2));
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.linearRampToValueAtTime(1, peakAt);
    g.gain.setValueAtTime(1, Math.max(peakAt, endAt - s.release));
    g.gain.linearRampToValueAtTime(0.0001, endAt);
    osc.connect(g);
    g.connect(out);
    osc.start(startAt);
    try { osc.stop(endAt + 0.05); } catch (_) {}
  }

  function schedulePadVoice(handle, s, freq, startAt, endAt, out) {
    if (!claimVoice(handle)) return;
    var ctx = handle.context;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.linearRampToValueAtTime(0.5, startAt + Math.min(s.attack, Math.max(0.05, endAt - startAt)));
    g.gain.setValueAtTime(0.5, Math.max(startAt, endAt - s.release));
    g.gain.linearRampToValueAtTime(0.0001, endAt);
    g.connect(out);
    var ratios = [1, 1.003];
    for (var i = 0; i < ratios.length; i += 1) {
      var osc = ctx.createOscillator();
      osc.type = s.wave;
      osc.frequency.value = freq * ratios[i];
      osc.connect(g);
      osc.start(startAt);
      try { osc.stop(endAt + 0.05); } catch (_) {}
    }
  }

  function scheduleNoiseWash(handle, s, startAt, endAt, out) {
    if (!claimVoice(handle)) return;
    var ctx = handle.context;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    var filter = ctx.createBiquadFilter();
    filter.type = s.filter;
    filter.frequency.setValueAtTime(s.filterFreq, startAt);
    if (s.filterEnd != null) {
      try { filter.frequency.exponentialRampToValueAtTime(s.filterEnd, endAt); } catch (_) {}
    }
    filter.Q.value = s.q;
    var g = ctx.createGain();
    var span = Math.max(0.01, endAt - startAt);
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.linearRampToValueAtTime(0.9, startAt + Math.min(s.attack, span));
    g.gain.setValueAtTime(0.9, Math.max(startAt, endAt - s.release));
    g.gain.linearRampToValueAtTime(0.0001, endAt);
    src.connect(filter);
    filter.connect(g);
    g.connect(out);
    src.start(startAt);
    try { src.stop(endAt + 0.05); } catch (_) {}
  }

  // Sample-free drum kit. Each hit is a tiny deterministic graph from the
  // seeded noise buffer and plain oscillators — no samples, no network:
  // kick is a pitched-down sine plus a click transient, snare a triangle
  // body plus bandpassed noise, hats highpassed noise, clap a burst train.
  function scheduleKick(handle, p, startAt, out) {
    var ctx = handle.context;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(Math.max(20, 150 * p.tone), startAt);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, 40 * p.tone), startAt + 0.12);
    var g = ctx.createGain();
    var dur = 0.4 * p.decay;
    g.gain.setValueAtTime(Math.max(0.0001, p.level), startAt);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(startAt);
    try { osc.stop(startAt + dur + 0.05); } catch (_) {}
    var click = ctx.createOscillator();
    click.type = 'sine';
    click.frequency.value = 800 * p.tone;
    var cg = ctx.createGain();
    cg.gain.setValueAtTime(Math.max(0.0001, 0.4 * p.level), startAt);
    cg.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.03);
    click.connect(cg);
    cg.connect(out);
    click.start(startAt);
    try { click.stop(startAt + 0.08); } catch (_) {}
  }

  function scheduleSnare(handle, p, startAt, out) {
    var ctx = handle.context;
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 180 * p.tone;
    var g = ctx.createGain();
    var bodyDur = 0.12 * p.decay;
    g.gain.setValueAtTime(Math.max(0.0001, 0.7 * p.level), startAt);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + bodyDur);
    osc.connect(g);
    g.connect(out);
    osc.start(startAt);
    try { osc.stop(startAt + bodyDur + 0.05); } catch (_) {}
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    var ng = ctx.createGain();
    var noiseDur = 0.2 * p.decay;
    ng.gain.setValueAtTime(Math.max(0.0001, 0.5 * p.level), startAt);
    ng.gain.exponentialRampToValueAtTime(0.0001, startAt + noiseDur);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    src.start(startAt);
    try { src.stop(startAt + noiseDur + 0.05); } catch (_) {}
  }

  function scheduleHat(handle, p, startAt, out, open) {
    var ctx = handle.context;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    var g = ctx.createGain();
    var dur = (open ? 0.3 : 0.05) * p.decay;
    g.gain.setValueAtTime(Math.max(0.0001, 0.3 * p.level), startAt);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(out);
    src.start(startAt);
    try { src.stop(startAt + dur + 0.05); } catch (_) {}
  }

  function scheduleClap(handle, p, startAt, out) {
    var ctx = handle.context;
    var b;
    for (b = 0; b < 3; b += 1) {
      var at = startAt + b * 0.025;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200 * p.tone;
      bp.Q.value = 1.5;
      var g = ctx.createGain();
      g.gain.setValueAtTime(Math.max(0.0001, 0.5 * p.level), at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      src.start(at, (b * 0.13) % 1.5);
      try { src.stop(at + 0.08); } catch (_) {}
    }
    var tail = ctx.createBufferSource();
    tail.buffer = noiseBuffer(ctx);
    var tbp = ctx.createBiquadFilter();
    tbp.type = 'bandpass';
    tbp.frequency.value = 1200 * p.tone;
    tbp.Q.value = 1.5;
    var tg = ctx.createGain();
    var tailDur = 0.15 * p.decay;
    tg.gain.setValueAtTime(Math.max(0.0001, 0.4 * p.level), startAt);
    tg.gain.exponentialRampToValueAtTime(0.0001, startAt + tailDur);
    tail.connect(tbp);
    tbp.connect(tg);
    tg.connect(out);
    tail.start(startAt);
    try { tail.stop(startAt + tailDur + 0.05); } catch (_) {}
  }

  function scheduleDrumHit(handle, s, hitName, startAt, out) {
    if (!claimVoice(handle)) return;
    var p = s.kit[hitName] || s.kit.snare;
    if (hitName === 'kick') scheduleKick(handle, p, startAt, out);
    else if (hitName === 'snare') scheduleSnare(handle, p, startAt, out);
    else if (hitName === 'hat') scheduleHat(handle, p, startAt, out, false);
    else if (hitName === 'openhat') scheduleHat(handle, p, startAt, out, true);
    else if (hitName === 'clap') scheduleClap(handle, p, startAt, out);
  }

  // Voice ducking without a sidechain compressor (Web Audio has no sidechain
  // input): a ducked cue gets a second gain in series whose automation is
  // computed up front from the declared voice ranges. Only linear ramps and
  // sets with finite times are used, so a degenerate range degrades to a
  // slightly-off curve, never to silent audio. Overlapping ranges merge.
  function scheduleDuckGain(ctx, cue, t0, startAt, endAt) {
    if (cue.duckRanges.length === 0 || !(cue.duckAmount < 1)) return null;
    var attack = cue.duckAttack;
    var release = cue.duckRelease;
    var amount = cue.duckAmount;
    var merged = [];
    var i;
    for (i = 0; i < cue.duckRanges.length; i += 1) {
      var rs = Math.max(startAt, Math.min(endAt, t0 + cue.duckRanges[i].start));
      var re = Math.max(startAt, Math.min(endAt, t0 + cue.duckRanges[i].end));
      if (!(re > rs)) continue;
      if (merged.length > 0 && rs - merged[merged.length - 1].end < attack + release) {
        if (re > merged[merged.length - 1].end) merged[merged.length - 1].end = re;
      } else {
        merged.push({ start: rs, end: re });
      }
    }
    if (merged.length === 0) return null;
    var g = ctx.createGain();
    g.gain.setValueAtTime(1, startAt);
    for (i = 0; i < merged.length; i += 1) {
      var dip = Math.max(startAt, merged[i].start - attack);
      if (dip > startAt) g.gain.setValueAtTime(1, dip);
      g.gain.linearRampToValueAtTime(amount, merged[i].start);
      g.gain.setValueAtTime(amount, merged[i].end);
      var out = Math.min(endAt, merged[i].end + release);
      if (out > merged[i].end) g.gain.linearRampToValueAtTime(1, out);
    }
    return g;
  }

  function scheduleSynthCue(handle, cue, startAt, endAt, out) {
    var s = cue.synth;
    var i;
    // absStart anchors note/hit grids to the ORIGINAL cue when a derived
    // segment cue re-roots the window: surviving events keep exact timing,
    // only events already finished before the window are skipped. A
    // percussive event straddling the window edge re-articulates at the
    // edge (masked by the segment seam fade); sustained voices hold exact
    // steady state via the instant attack on trimmed starts.
    var gridBase = (typeof cue.absStart === 'number') ? cue.absStart : startAt;
    if (s.kind === 'tone') {
      for (i = 0; i < s.freqs.length; i += 1) {
        var nStartAbs = gridBase + i * s.noteDur;
        if (nStartAbs >= endAt) break;
        if (nStartAbs + s.noteDur + s.release <= startAt) continue;
        var nStart = Math.max(startAt, nStartAbs);
        schedulePluck(handle, s, s.freqs[i], nStart, Math.min(endAt, nStartAbs + s.noteDur + s.release), out);
      }
    } else if (s.kind === 'pad') {
      for (i = 0; i < s.freqs.length; i += 1) {
        schedulePadVoice(handle, s, s.freqs[i], startAt, endAt, out);
      }
    } else if (s.kind === 'noise') {
      scheduleNoiseWash(handle, s, startAt, endAt, out);
    } else if (s.kind === 'drums') {
      for (i = 0; i < s.hits.length; i += 1) {
        var hitAbs = gridBase + s.hits[i].at;
        if (hitAbs >= endAt) break;
        var hitAt = Math.max(startAt, hitAbs);
        scheduleDrumHit(handle, s, s.hits[i].hit, hitAt, out);
      }
    }
  }

  // Slice of an audio cue for one export segment [segStart, segEnd).
  // Returns null when the cue does not overlap the segment. The derived cue
  // is scheduled at t0 = 0 with segment-relative times, keeping every time
  // non-negative (Web Audio throws on negative schedule times): absolute
  // grids (note/hit indexing, duck ranges, file offsets) shift by the sliced
  // amount, sliced edges get near-instant fades, and sustained voices hold
  // exact steady state via near-zero attack on trimmed starts.
  function deriveSegmentCue(cue, segStart, segEnd) {
    var cueEnd = cue.start + cue.duration;
    if (!(cueEnd > segStart) || !(cue.start < segEnd)) return null;
    var o0 = Math.max(cue.start, segStart);
    var o1 = Math.min(cueEnd, segEnd);
    var shift = o0 - cue.start;
    var out = {};
    var k;
    for (k in cue) {
      if (Object.prototype.hasOwnProperty.call(cue, k)) out[k] = cue[k];
    }
    out.start = o0 - segStart;
    out.duration = Math.max(0.001, o1 - o0);
    out.fadeIn = (o0 > cue.start) ? 0.005 : cue.fadeIn;
    out.fadeOut = (o1 < cueEnd) ? 0.005 : cue.fadeOut;
    if (cue.kind === 'file' && typeof cue.offset === 'number') {
      out.offset = cue.offset + shift;
    }
    if (cue.kind === 'synth' && cue.synth && typeof cue.synth === 'object') {
      var s = {};
      for (k in cue.synth) {
        if (Object.prototype.hasOwnProperty.call(cue.synth, k)) s[k] = cue.synth[k];
      }
      if (o0 > cue.start) s.attack = 0.005;
      out.synth = s;
      // Absolute cue start in segment frame (may be negative): anchors the
      // note/hit grid so surviving events keep exact timing.
      out.absStart = cue.start - segStart;
    }
    if (Array.isArray(cue.duckRanges)) {
      out.duckRanges = cue.duckRanges.map(function (r) {
        return { start: r.start - shift, end: r.end - shift };
      });
    }
    out.sourceCue = cue;
    return out;
  }

  function scheduleAudioCue(handle, cue, t0, entryOverride) {
    var ctx = handle.context;
    var startAt = t0 + cue.start;
    var endAt = startAt + cue.duration;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, cue.volume), startAt + Math.min(cue.fadeIn, cue.duration));
    gain.gain.setValueAtTime(Math.max(0.0001, cue.volume), Math.max(startAt, endAt - cue.fadeOut));
    gain.gain.linearRampToValueAtTime(0.0001, endAt);
    var bus = gain;
    var duckGain = scheduleDuckGain(ctx, cue, t0, startAt, endAt);
    if (duckGain) {
      gain.connect(duckGain);
      bus = duckGain;
    }
    bus.connect(handle.master);
    if (handle.fxReverb && cue.reverb > 0) {
      var revSend = ctx.createGain();
      revSend.gain.value = cue.reverb;
      bus.connect(revSend);
      revSend.connect(handle.fxReverb);
    }
    if (handle.fxDelay && cue.delay > 0) {
      var dlySend = ctx.createGain();
      dlySend.gain.value = cue.delay;
      bus.connect(dlySend);
      dlySend.connect(handle.fxDelay);
    }
    if (cue.kind === 'file') {
      var entry = entryOverride || null;
      if (!entry) {
        for (var i = 0; i < handle.decoded.length; i += 1) {
          if (handle.decoded[i].cue === cue) { entry = handle.decoded[i]; break; }
        }
      }
      if (!entry) return;
      var src = ctx.createBufferSource();
      src.buffer = entry.buffer;
      src.loop = cue.loop === true;
      src.connect(gain);
      if (cue.loop) {
        // Loop windows always span the whole file (windowStart 0), so this
        // modulo indexes the original file positions exactly.
        var loopOffset = cue.offset % entry.buffer.duration;
        src.start(startAt, loopOffset < 0 ? 0 : loopOffset);
        try { src.stop(endAt + 0.05); } catch (_) {}
      } else {
        // The window may start partway into the file; rebase the file
        // position onto the window. A negative result means the window and
        // the cue disagree — src.start throws rather than play shifted audio.
        var bufOffset = cue.offset - (entry.windowStart || 0);
        var avail = Math.max(0, entry.buffer.duration - bufOffset);
        var playDur = Math.min(cue.duration, avail);
        if (playDur <= 0) return;
        src.start(startAt, bufOffset, playDur);
        try { src.stop(startAt + playDur + 0.05); } catch (_) {}
      }
      return;
    }
    scheduleSynthCue(handle, cue, startAt, endAt, gain);
  }

  function analyzeMixedClips(clips, duration, sampleRate, masterLevel) {
    if (!analysis || clips.length === 0 || !(sampleRate > 0)) return null;
    try {
      var samples = analysis.mixClipsToMono(clips, duration, sampleRate, masterLevel);
      return analysis.analyzeAudio(samples, sampleRate, duration);
    } catch (_) {
      return null;
    }
  }

  function buildFxBuses(context, master, fx) {
    var buses = { fxReverb: null, fxDelay: null };
    fx = fx || { reverb: null, delay: null };
    if (fx.reverb) {
      try {
        var conv = context.createConvolver();
        conv.buffer = makeImpulse(context, fx.reverb.decay);
        var wet = context.createGain();
        wet.gain.value = 0.5;
        conv.connect(wet);
        wet.connect(master);
        buses.fxReverb = conv;
      } catch (_) {
        postAudioWarning('Reverb is not supported here; continuing dry.');
      }
    }
    if (fx.delay) {
      try {
        var dly = context.createDelay(2.0);
        dly.delayTime.value = fx.delay.time;
        var fb = context.createGain();
        fb.gain.value = fx.delay.feedback;
        var damp = context.createBiquadFilter();
        damp.type = 'lowpass';
        damp.frequency.value = 2000;
        var dwet = context.createGain();
        dwet.gain.value = fx.delay.mix;
        dly.connect(fb);
        fb.connect(damp);
        damp.connect(dly);
        dly.connect(dwet);
        dwet.connect(master);
        buses.fxDelay = dly;
      } catch (_) {
        postAudioWarning('Echo is not supported here; continuing dry.');
      }
    }
    return buses;
  }

  // --- windowed soundtrack loading ----------------------------------------
  // Every segment used to re-fetch and decodeAudioData-decode the WHOLE
  // soundtrack before frame 1 — O(segments) decodes of the same bytes, the
  // dominant fixed cost of long renders. A WAV (the native decode the asset
  // lane serves, or a PCM16 workspace .wav) can be sliced by byte range
  // instead: read the header, work out which samples this segment's cues
  // actually play, fetch only those bytes and convert them here. Anything
  // unexpected — not RIFF, not PCM16, no Range support, a fetch failure —
  // resolves to null or rejects into loadFileEntry, which falls back to
  // the whole-file path: the pre-existing behavior, slow but never wrong.

  function parseWavHead(head) {
    if (!head || head.byteLength < 44) return null;
    var view = new DataView(head);
    if (view.getUint32(0, true) !== 0x46464952) return null; // "RIFF"
    if (view.getUint32(8, true) !== 0x45564157) return null; // "WAVE"
    var pos = 12;
    var fmt = null;
    var data = null;
    while (pos + 8 <= head.byteLength) {
      var id = view.getUint32(pos, true);
      var size = view.getUint32(pos + 4, true);
      var body = pos + 8;
      if (id === 0x20746d66) { // "fmt "
        if (body + 16 > head.byteLength) return null;
        fmt = {
          format: view.getUint16(body, true),
          channels: view.getUint16(body + 2, true),
          sampleRate: view.getUint32(body + 4, true),
          blockAlign: view.getUint16(body + 12, true),
          bits: view.getUint16(body + 14, true)
        };
      } else if (id === 0x61746164) { // "data"
        data = { offset: body, size: size };
      }
      // size 0 advances one chunk header; a runaway size leaves the loop.
      pos = body + size + (size & 1);
    }
    if (!fmt || !data) return null;
    // Only plain 16-bit PCM can be converted sample-accurately here; every
    // other encoding falls back to decodeAudioData.
    if (fmt.format !== 1 || fmt.bits !== 16) return null;
    if (fmt.channels < 1 || fmt.sampleRate < 1) return null;
    if (fmt.blockAlign !== fmt.channels * 2) return null;
    return { fmt: fmt, data: data };
  }

  function fetchAudioRange(url, byte0, byte1) {
    return fetch(url, { headers: { Range: 'bytes=' + byte0 + '-' + (byte1 - 1) } }).then(function (res) {
      if (!res.ok) throw new Error('Could not load an audio asset.');
      if (res.status === 206) {
        return res.arrayBuffer().then(function (body) {
          // A short or overshooting window would shift every later sample.
          if (body.byteLength !== byte1 - byte0) throw new Error('Short audio range.');
          return body;
        });
      }
      // The server answered with the whole file; slice it here.
      return res.arrayBuffer().then(function (body) {
        if (body.byteLength < byte1) throw new Error('Audio range past end of file.');
        return body.slice(byte0, byte1);
      });
    });
  }

  function windowedAudioEntry(cue, context, segOffset, segEnd) {
    // Loop cues wrap inside the source buffer: correct modulo playback
    // needs the whole file (windowStart 0), so loops never window below it.
    var wholeFile = cue.loop === true;
    return fetch(cue.src, { headers: { Range: 'bytes=0-4095' } }).then(function (res) {
      if (!res.ok) throw new Error('Could not load an audio asset.');
      return res.arrayBuffer();
    }).then(function (head) {
      var parsed = parseWavHead(head);
      if (!parsed) return null;
      var derived = deriveSegmentCue(cue, segOffset, segEnd);
      if (!derived) return null;
      var fmt = parsed.fmt;
      var data = parsed.data;
      var totalFrames = Math.floor(data.size / fmt.blockAlign);
      var from;
      var to;
      if (wholeFile) {
        from = 0;
        to = totalFrames;
      } else {
        from = Math.max(0, Math.floor(derived.offset * fmt.sampleRate));
        to = Math.min(
          totalFrames,
          Math.ceil((derived.offset + derived.duration) * fmt.sampleRate),
        );
      }
      if (to <= from) return null;
      var byte0 = data.offset + from * fmt.blockAlign;
      var byte1 = data.offset + to * fmt.blockAlign;
      return fetchAudioRange(cue.src, byte0, byte1).then(function (body) {
        var frames = Math.floor(body.byteLength / fmt.blockAlign);
        if (frames <= 0) return null;
        var buffer = context.createBuffer(fmt.channels, frames, fmt.sampleRate);
        var view = new DataView(body);
        var channels = [];
        for (var c = 0; c < fmt.channels; c += 1) channels.push(buffer.getChannelData(c));
        // Interleaved int16 -> float32, the same v/32768 mapping WebAudio's
        // decoder applies, so a window and a full decode sound identical.
        for (var i = 0; i < frames; i += 1) {
          var base = i * fmt.blockAlign;
          for (var ch = 0; ch < fmt.channels; ch += 1) {
            channels[ch][i] = view.getInt16(base + ch * 2, true) / 32768;
          }
        }
        return { cue: cue, buffer: buffer, windowStart: from / fmt.sampleRate };
      });
    });
  }

  function decodeWholeAudioEntry(cue, context) {
    return fetch(cue.src).then(function (response) {
      if (!response.ok) throw new Error('Could not load an audio asset.');
      return response.arrayBuffer();
    }).then(function (bytes) { return context.decodeAudioData(bytes); })
      .then(function (buffer) { return { cue: cue, buffer: buffer, windowStart: 0 }; });
  }

  function loadFileEntry(cue, context, segOffset, segEnd) {
    return windowedAudioEntry(cue, context, segOffset, segEnd).then(function (entry) {
      return entry || decodeWholeAudioEntry(cue, context);
    }, function () {
      // Probe or window fetch failed: keep the pre-existing whole-file path.
      return decodeWholeAudioEntry(cue, context);
    });
  }

  // Export sound in sample time, not wall time. Rendering a frame may take
  // seconds without dropping an audio callback or stretching AAC timestamps.
  function prepareOfflineAudio(schedule, duration, segOffset, segLen) {
    var Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) return Promise.reject(new Error('Offline audio rendering is unavailable on this device.'));
    var offset = (typeof segOffset === 'number' && segOffset > 0) ? segOffset : 0;
    var length = (typeof segLen === 'number' && segLen > 0) ? Math.min(segLen, Math.max(0.5, duration - offset)) : duration;
    var context = new Offline(2, Math.ceil(length * 48000), 48000);
    var master = context.createGain();
    master.gain.value = schedule.master;
    master.connect(context.destination);
    var buses = buildFxBuses(context, master, schedule.fx);
    var handle = {
      context: context, master: master, decoded: [],
      fxReverb: buses.fxReverb, fxDelay: buses.fxDelay,
      voices: 0, voiceOverflow: false, offlineBuffer: null, features: null
    };
    var segEnd = offset + length;
    function overlaps(cue) {
      return (cue.start + cue.duration > offset) && (cue.start < segEnd);
    }
    var chain = Promise.resolve();
    schedule.cues.forEach(function (cue) {
      if (cue.kind !== 'file' || !overlaps(cue)) return;
      chain = chain.then(function () {
        if (cancelled) throw new Error('Video export cancelled.');
        return loadFileEntry(cue, context, offset, segEnd).then(function (entry) {
          handle.decoded.push(entry);
        });
      });
    });
    return chain.then(function () {
      if (cancelled) throw new Error('Video export cancelled.');
      schedule.cues.forEach(function (cue) {
        if (!overlaps(cue)) return;
        var use = cue;
        var entry = null;
        if (offset > 0 || length < duration) {
          var derived = deriveSegmentCue(cue, offset, segEnd);
          if (!derived) return;
          use = derived;
        }
        if (cue.kind === 'file') {
          for (var i = 0; i < handle.decoded.length; i += 1) {
            if (handle.decoded[i].cue === cue) { entry = handle.decoded[i]; break; }
          }
          if (!entry) return;
        }
        scheduleAudioCue(handle, use, 0, entry);
      });
      if (handle.voiceOverflow) throw new Error('The soundtrack exceeds the supported simultaneous voice limit.');
      if (schedule.cues.some(function (cue) { return cue.kind === 'synth' && cue.synth.kind === 'drums' && cue.synth.capped; })) {
        postAudioWarning('Drum steps past 512 hits were skipped; shorten the pattern or split it across tracks.');
      }
      return context.startRendering();
    }).then(function (buffer) {
      if (cancelled) throw new Error('Video export cancelled.');
      applySeamFades(buffer, offset, segEnd, duration);
      handle.offlineBuffer = buffer;
      var channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      handle.features = analyzeMixedClips([{
        channels: channels, sampleRate: 48000, start: 0, offset: 0,
        duration: length, loop: false, volume: 1, fadeIn: 0, fadeOut: 0
      }], length, 48000, 1);
      // Release source buffers and the offline graph after mixing. Only the
      // bounded segment soundtrack remains during export.
      handle.decoded = [];
      handle.context = null;
      handle.master = null;
      handle.fxReverb = null;
      handle.fxDelay = null;
      post({ type: 'mobileAgentVideoAudioConfig', sampleRate: 48000, channels: 2, encoding: 'pcm16' });
      return handle;
    });
  }

  // 50 ms raised-cosine fades at segment seams so concatenated segments do
  // not click. Interior edges only: the video's true start/end keep the
  // scene's own envelope.
  function applySeamFades(buffer, segStart, segEnd, duration) {
    var rate = 48000;
    var fade = Math.floor(rate * 0.05);
    var total = buffer.length;
    if (!(fade > 1) || total <= 0) return;
    var ch, data, i, n, gain;
    for (ch = 0; ch < buffer.numberOfChannels; ch += 1) {
      data = buffer.getChannelData(ch);
      if (segStart > 0) {
        n = Math.min(fade, total);
        for (i = 0; i < n; i += 1) {
          gain = 0.5 - 0.5 * Math.cos(Math.PI * i / n);
          data[i] = data[i] * gain;
        }
      }
      if (segEnd < duration - 0.001) {
        n = Math.min(fade, total);
        for (i = 0; i < n; i += 1) {
          gain = 0.5 - 0.5 * Math.cos(Math.PI * i / n);
          data[total - 1 - i] = data[total - 1 - i] * gain;
        }
      }
    }
  }

  function sendOfflineAudio() {
    var buffer = activeAudio && activeAudio.offlineBuffer;
    if (!buffer) return Promise.resolve();
    // Segment is already local: this page rendered exactly [segOffset,
    // segOffset+segLen), and each segment file's audio track must start at
    // zero like its video. Absolute timestamps here would break the native
    // encoder, whose clock is the sample count from zero (it re-creates per
    // segment), and desync the track in the concatenated MP4.
    var left = buffer.getChannelData(0);
    var right = buffer.getChannelData(1);
    var offset = 0;
    function next() {
      if (cancelled) return Promise.reject(new Error('Video export cancelled.'));
      if (offset >= buffer.length) return Promise.resolve();
      var count = Math.min(4096, buffer.length - offset);
      var bytes = new Uint8Array(count * 4);
      var view = new DataView(bytes.buffer);
      for (var i = 0; i < count; i += 1) {
        view.setInt16(i * 4, Math.round(clamp(left[offset + i], -1, 1) * 32767), true);
        view.setInt16(i * 4 + 2, Math.round(clamp(right[offset + i], -1, 1) * 32767), true);
      }
      var pts = Math.round(offset * 1000000 / 48000);
      offset += count;
      return postAndWait({ type: 'mobileAgentVideoAudioPcmChunk', pts: pts, base64: bytesToBase64(bytes) }).then(next);
    }
    return next();
  }

  // Wall-clock cost of soundtrack prep (fetch + whole-file decode + offline
  // mix) for this page, reported in the done timings. The per-frame stats
  // cannot see it: audio prep runs before frame 1 and repeats in full on
  // every segment page, so it is exactly the fixed cost that must be visible
  // when attributing a slow segmented render. 0 when the scene is silent.
  var audioPrepMs = 0;

  function start(offsetSeconds, segmentSeconds) {
    if (running) return;
    var contract = readContract();
    if (!contract) {
      post({ type: 'mobileAgentVideoUnsupported' });
      return;
    }
    var duration = clamp(Number(contract.duration) || 10, 1, 600);
    var fps = clamp(Number(contract.fps) || 30, 5, 60);
    var width = Math.round(clamp(Number(contract.width) || 1280, 160, 1920));
    var height = Math.round(clamp(Number(contract.height) || 720, 160, 1920));
    if (width % 2 !== 0) width += 1;
    if (height % 2 !== 0) height += 1;
    // Segmented export: one job renders [segOffset, segOffset + segLen).
    // Single-segment callers pass nothing and render the whole contract.
    var segOffset = (typeof offsetSeconds === 'number' && offsetSeconds > 0)
      ? Math.min(offsetSeconds, Math.max(0, duration - 1))
      : 0;
    var segLen = (typeof segmentSeconds === 'number' && segmentSeconds > 0)
      ? clamp(segmentSeconds, 1, 45)
      : duration;
    segLen = Math.min(segLen, Math.max(1, duration - segOffset));
    var frameCount = Math.max(1, Math.round(segLen * fps));
    // Shots are resolved once per page, not per frame: validation and
    // Function#toString on every frame would be pure overhead.
    var shots = contractShots(contract);

    var canvas = resolveCanvas(contract);
    if (!canvas) {
      post({ type: 'mobileAgentVideoUnsupported' });
      return;
    }
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (_) { ctx = null; }

    try {
      hijackCanvas(canvas, width, height);
    } catch (error) {
      fail('Video canvas setup failed: ' + String((error && error.message) || error));
      return;
    }
    post({
      type: 'mobileAgentVideoConfig',
      width: width,
      height: height,
      fps: fps,
      frameCount: frameCount,
      duration: segLen
    });

    running = true;
    cancelled = false;
    try { window.MOBILE_AGENT_VIDEO_RECORDING = true; } catch (_) {}

    var schedule = readAudioSchedule(contract, duration);
    if (!schedule && contract.audio !== false && document.querySelectorAll('video').length > 0) {
      fail('This scene contains video clips but no audio schedule. Preserve the main video soundtrack with audio: { tracks: [{ file: "workspace://<main-video-id>", start: 0, offset: 0, volume: 1 }] }, or set audio: false for an intentionally silent export. Muted video elements do not export their sound.');
      return;
    }
    if (!schedule && contract.audio && typeof contract.audio === 'object') {
      fail('The audio schedule has no usable tracks. Supply file or synth tracks, or set audio: false for an intentionally silent export.');
      return;
    }
    var audioPrepStarted = Date.now();
    var audioReady = schedule ? prepareOfflineAudio(schedule, duration, segOffset, segLen) : Promise.resolve(null);
    audioReady.then(function (audio) {
      if (schedule) audioPrepMs = Date.now() - audioPrepStarted;
      if (cancelled) {
        if (audio) releaseAudio(audio);
        return;
      }
      activeAudio = audio;
      activeAudioApi = analysis ? analysis.createAudioApi(activeAudio ? activeAudio.features : null) : null;
      try { window.MOBILE_AGENT_VIDEO_AUDIO = activeAudioApi; } catch (_) {}
      activeSpeechApi = (analysis && analysis.createSpeechApi)
        ? analysis.createSpeechApi(contract.speech, duration)
        : null;
      try { window.MOBILE_AGENT_VIDEO_SPEECH = activeSpeechApi; } catch (_) {}
      runNativeFrames(contract, canvas, ctx, fps, frameCount, segOffset, shots);
    }).catch(function (error) {
      // Rejections (decode failure, synth render failure) fail loud.
      // Never-settling promises still hang until the run aborts — no timer
      // by design; legit 45 s schedules can need the full prep budget.
      fail('Video export preparation failed: ' + String((error && error.message) || error));
    });
  }

  // One-time session warnings surfaced in the render result, e.g. "clip
  // frames are moved by the default global seek but the scene never declared
  // a timeline". Collected during the run, posted on done.
  var runtimeWarnings = [];
  var warned = {};
  function warnOnce(key, message) {
    if (warned[key]) return;
    warned[key] = true;
    if (runtimeWarnings.length < 4) runtimeWarnings.push(message);
  }

  // The declared clip timeline for this scene, or null. attach() validates
  // contract.clips data loudly (a bad selector must fail the render, not
  // silently freeze a clip); scenes that called __mobileAgentClips.declare
  // themselves are picked up through the installed timeline.
  function clipTimelineFor(contract) {
    try {
      if (window.__mobileAgentClips && typeof window.__mobileAgentClips.attach === 'function') {
        var fromContract = window.__mobileAgentClips.attach(contract);
        if (fromContract) return fromContract;
      }
    } catch (error) {
      throw new Error('Scene clips are misconfigured: ' + String((error && error.message) || error));
    }
    try {
      return (window.__mobileAgentClips && window.__mobileAgentClips.timeline()) || null;
    } catch (_) {
      return null;
    }
  }

  // Source video decoding is asynchronous. Never draw the previous decoded
  // frame immediately after assigning currentTime. Frame prep is ADDITIVE:
  // the declared clip timeline owns the frames of the clips it declares, a
  // legacy scene prepareFrame() owns every <video> frame (unchanged
  // semantics — overwriting a scene's own offsets would corrupt it — with a
  // loud warning instead), and every video nobody owns gets the default
  // global-t seek. Scene images are awaited no matter who owns clip frames:
  // they were silently skipped whenever prepareFrame existed.
  function prepareSourceFrame(contract, t, fps) {
    var waits = [];
    var images = document.querySelectorAll('img[data-mobile-agent-asset]');
    for (var j = 0; j < images.length; j += 1) {
      waits.push(awaitSceneImage(images[j]));
    }
    var videos = document.querySelectorAll('video');
    var timeline = clipTimelineFor(contract);
    if (timeline) {
      waits.push(timeline.prepareFrame(t));
      var elements = timeline.ownedElements();
      var undeclared = 0;
      for (var u = 0; u < videos.length; u += 1) {
        if (elements.indexOf(videos[u]) >= 0) continue;
        if (typeof videos[u].pause !== 'function') continue;
        undeclared += 1;
        waits.push(seekSourceVideo(videos[u], t, fps));
      }
      if (undeclared > 0) {
        warnOnce('undeclared', undeclared + ' of ' + videos.length + ' video elements are not declared in window.MOBILE_AGENT_VIDEO.clips; they are seeked to global video time, which is correct only for clips that fill the whole video. Declare every clip so its window and source offset are honored.');
      }
      return Promise.all(waits);
    }
    if (typeof contract.prepareFrame === 'function') {
      waits.push(Promise.resolve().then(function () { return contract.prepareFrame(t); }));
      warnOnce('prepareFrame', 'This scene defines prepareFrame, which takes over clip frames entirely: every clip it does not seek shows a stale frame in the render and stills. Declare window.MOBILE_AGENT_VIDEO.clips so every clip is mapped, seeked, and verified.');      return Promise.all(waits);
    }
    for (var i = 0; i < videos.length; i += 1) {
      // Test doubles and non-media elements do not implement pause().
      if (typeof videos[i].pause !== 'function') continue;
      waits.push(seekSourceVideo(videos[i], t, fps));
    }
    return Promise.all(waits);
  }

  function seekSourceVideo(video, t, fps) {
    return new Promise(function (resolve, reject) {
      var target = null;
      var retried = false;
      var finished = false;
      var timer = null;
      function detach() {
        video.removeEventListener('loadedmetadata', seek);
        video.removeEventListener('seeked', ready);
        video.removeEventListener('loadeddata', ready);
        video.removeEventListener('error', failed);
      }
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        detach();
        if (error) reject(error); else resolve();
      }
      // One bounded recovery before failing loud: a source video whose
      // readyState is stuck at 1 ('seeked' never fires) or whose decoder
      // allocation was refused under the device codec cap both clear when
      // resource selection re-runs. A second stall keeps the loud failure.
      function recoverOrFail(finalMessage) {
        if (retried || typeof video.load !== 'function') {
          finish(new Error(finalMessage + (retried ? ' Reloaded once and it still stalled.' : '')));
          return;
        }
        retried = true;
        clearTimeout(timer);
        detach();
        try {
          video.load();
        } catch (error) {
          finish(new Error(finalMessage + ' (reload failed: ' + String((error && error.message) || error) + ')'));
          return;
        }
        start();
      }
      function failed() { recoverOrFail('A source video could not be decoded.'); }
      function timedOut() { recoverOrFail('Timed out decoding a source video frame.'); }
      function ready() {
        if (cancelled) { finish(new Error('Video export cancelled.')); return; }
        if (!video.seeking && video.readyState >= 2) finish();
      }
      function seek() {
        if (cancelled) { finish(new Error('Video export cancelled.')); return; }
        video.pause();
        if (!(video.duration > 0) || !isFinite(video.duration)) { failed(); return; }
        target = video.loop ? t % video.duration : Math.min(t, Math.max(0, video.duration - 1 / fps));
        try {
          if (Math.abs(video.currentTime - target) > 0.0001) video.currentTime = target;
          ready();
        } catch (error) { finish(error); }
      }
      function start() {
        timer = setTimeout(timedOut, 15000);
        video.addEventListener('loadedmetadata', seek);
        video.addEventListener('seeked', ready);
        video.addEventListener('loadeddata', ready);
        video.addEventListener('error', failed);
        if (video.readyState >= 1) seek();
      }
      start();
    });
  }

  // Workspace images are tagged by the asset inliner. An image that never
  // decodes (corrupt data, unsupported format, or too large for this device)
  // surfaces as complete + naturalWidth === 0, and a scene following the
  // documented "complete && naturalWidth" draw guard would skip the draw and
  // silently render that visual blank. Await and validate instead, so the
  // export fails loud with the source named, not blank.
  function awaitSceneImage(img) {
    return new Promise(function (resolve, reject) {
      var timer = null;
      function source() {
        try { return String(img.currentSrc || img.src || '(no src)'); } catch (_) { return '(unknown source)'; }
      }
      function finish(error) {
        clearTimeout(timer);
        img.removeEventListener('load', ready);
        img.removeEventListener('error', failed);
        if (error) reject(error); else resolve();
      }
      function failed(extra) {
        finish(new Error('A scene image could not be decoded (it may be too large for this device)' + (extra || '') + ': ' + source()));
      }
      function ready() {
        if (cancelled) { finish(new Error('Video export cancelled.')); return; }
        if (!img.complete) return;
        if (!(img.naturalWidth > 0)) { failed(); return; }
        finish();
      }
      timer = setTimeout(function () { failed(' before it was ready'); }, 15000);
      img.addEventListener('load', ready);
      img.addEventListener('error', failed);
      ready();
    });
  }

  function pauseSourceVideos() {
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i += 1) {
      try { videos[i].pause(); } catch (_) {}
    }
  }

  // Depth-1 export pipeline: while native encodes frame N (bridge wait),
  // the page already seeks, renders, and captures frame N+1. Submissions
  // stay strictly ordered (N+1 posts only after N is acknowledged), so the
  // native order invariant, pacing, and failure behavior are unchanged —
  // the page-side wait just overlaps the native-side wait instead of
  // adding to it. At most one extra JPEG is ever held.
  function runNativeFrames(contract, canvas, ctx, fps, frameCount, segOffset, shots) {
    var index = 0; // next frame to prepare (page work: seek/render/capture)
    var sendIndex = 0; // next frame to submit (bridge work: postAndWait)
    var emitted = 0;
    var clockBase = (typeof segOffset === 'number' && segOffset > 0) ? segOffset : 0;
    var ready = {}; // index -> base64 jpeg prepared ahead (at most one entry)
    var preparing = false; // a single shared video element/canvas: one prepare at a time
    var sending = false;
    // Per-stage wall clock (ms): page seek/render, canvas JPEG capture, and
    // the native encoder's ack of each frame. Attached to the done message so
    // slow stages are visible in the result instead of guessed at.
    var timing = {
      frames: 0,
      prepare: { sum: 0, max: 0 },
      capture: { sum: 0, max: 0 },
      bridge: { sum: 0, max: 0 }
    };
    // performance is not part of every WebView/test-harness global set.
    function clock() {
      return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }
    function track(slot, ms) {
      if (!isFinite(ms) || !(ms >= 0)) return;
      slot.sum += ms;
      if (ms > slot.max) slot.max = ms;
    }
    function timingSummary() {
      var frames = Math.max(1, timing.frames);
      return {
        frames: timing.frames,
        prepareAvgMs: Math.round(timing.prepare.sum / frames),
        prepareMaxMs: Math.round(timing.prepare.max),
        captureAvgMs: Math.round(timing.capture.sum / frames),
        captureMaxMs: Math.round(timing.capture.max),
        bridgeAvgMs: Math.round(timing.bridge.sum / frames),
        bridgeMaxMs: Math.round(timing.bridge.max),
        audioPrepMs: audioPrepMs
      };
    }

    function finish() {
      sendOfflineAudio().then(function () {
        if (cancelled) { teardown(); return; }
        post({ type: 'mobileAgentVideoDone', emitted: emitted, timings: timingSummary(), visualWarnings: pullVisualWarnings() });
        teardown();
      }).catch(function (error) {
        fail('Soundtrack export failed: ' + String((error && error.message) || error));
      });
    }

    // Clip-timeline diagnostics gathered during the run, plus the helper's own
    // issue notes (held/looped clips). Posted once, capped; empty most runs.
    function pullVisualWarnings() {
      var out = runtimeWarnings.slice(0);
      try {
        var clips = window.__mobileAgentClips;
        var issues = clips && typeof clips.issues === 'function' ? clips.issues() : [];
        for (var i = 0; i < issues.length && out.length < 6; i += 1) out.push(issues[i]);
      } catch (_) {}
      return out;
    }

    function next() {
      if (cancelled) return;
      maybeSend();
      pump();
    }

    function maybeSend() {
      if (cancelled || sending) return;
      if (sendIndex >= frameCount) return;
      var base64 = ready[sendIndex];
      if (base64 === undefined) return;
      sending = true;
      var bridgeStart = clock();
      postAndWait({ type: 'mobileAgentVideoFrame', index: emitted, frameCount: frameCount, base64: base64 }).then(function () {
        track(timing.bridge, clock() - bridgeStart);
        sending = false;
        delete ready[sendIndex];
        emitted += 1;
        sendIndex += 1;
        if (sendIndex >= frameCount) { finish(); return; }
        // Yield between frames. Timeline position depends only on the index,
        // not rendering speed, and only one JPEG crosses the bridge at a time.
        timers.push(setTimeout(next, 0));
      }).catch(function (error) {
        fail('Frame export failed: ' + String((error && error.message) || error));
      });
      // Overlap: prepare the next frame while native encodes this one.
      pump();
    }

    function pump() {
      if (cancelled || preparing) return;
      if (index >= frameCount) return;
      if (index > sendIndex + 1) return;
      if (ready[index] !== undefined) return;
      preparing = true;
      var myIndex = index;
      index += 1;
      var t = clockBase + myIndex / fps;
      var prepareStart = clock();
      prepareSourceFrame(contract, t, fps).then(function () {
        if (cancelled) { preparing = false; return; }
        if (!renderFrame(contract, canvas, ctx, t, shots)) { preparing = false; return; }
        track(timing.prepare, clock() - prepareStart);
        timing.frames += 1;
        // Legacy scenes may call play() inside render(). Export is clocked by
        // frame index instead, so do not let playback advance between frames.
        pauseSourceVideos();
        var dataUrl = null;
        var captureStart = clock();
        try {
          dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        } catch (error) {
          preparing = false;
          fail('Frame capture failed: ' + String((error && error.message) || error));
          return;
        }
        track(timing.capture, clock() - captureStart);
        var comma = dataUrl.indexOf(',');
        ready[myIndex] = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        preparing = false;
        next();
      }).catch(function (error) {
        preparing = false;
        fail('Source video preparation failed: ' + String((error && error.message) || error));
      });
    }

    if (frameCount <= 0) { finish(); return; }
    pump();
  }

  function bytesToBase64(bytes) {
    var parts = [];
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
    }
    return btoa(parts.join(''));
  }

  // Scene plan for incremental rendering: timing plus a fingerprint per
  // declared shot. The shared hash covers the document with each shot's own
  // source removed, so editing one shot leaves it unchanged, while any shared
  // helper, asset, clip, or audio-schedule edit invalidates every segment.
  function describeContract() {
    var contract = readContract();
    if (!contract) return null;
    var duration = clamp(Number(contract.duration) || 10, 1, 600);
    var fps = clamp(Number(contract.fps) || 30, 5, 60);
    var width = Math.round(clamp(Number(contract.width) || 1280, 160, 1920));
    var height = Math.round(clamp(Number(contract.height) || 720, 160, 1920));
    var shots = contractShots(contract);
    var documentText = '';
    try {
      documentText = document.documentElement ? document.documentElement.outerHTML : '';
    } catch (_) { documentText = ''; }
    var planShots = [];
    if (shots) {
      for (var i = 0; i < shots.length; i += 1) {
        var shot = shots[i];
        // Remove this shot's own source so a single-shot edit leaves the
        // shared hash untouched; the shot hash below carries the change.
        if (shot.source) documentText = documentText.split(shot.source).join('');
        planShots.push({
          id: shot.id,
          start: shot.start,
          end: shot.end,
          hash: fnv1a(shot.id + '\\u0000' + shot.start + '\\u0000' + shot.end + '\\u0000' + shot.source)
        });
      }
    }
    return {
      duration: duration,
      fps: fps,
      width: width,
      height: height,
      sharedHash: fnv1a(documentText),
      shots: planShots
    };
  }

  window.__probeMobileAgentVideo = function () {
    if (running) return;
    var plan = describeContract();
    if (!plan) {
      post({ type: 'mobileAgentVideoUnsupported' });
      return;
    }
    post({
      type: 'mobileAgentVideoPlan',
      duration: plan.duration,
      fps: plan.fps,
      width: plan.width,
      height: plan.height,
      sharedHash: plan.sharedHash,
      shots: plan.shots
    });
  };

  window.__startMobileAgentVideoExport = start;
  window.__cancelMobileAgentVideoExport = cancel;
  // Reused by same-page tools (mix check) and the live preview player:
  // schedule validation, per-cue scheduling, cue derivation for resumed
  // playback positions, and FX buses — without starting a recording.
  window.__mobileAgentAudioEngine = {
    readAudioSchedule: readAudioSchedule,
    scheduleAudioCue: scheduleAudioCue,
    buildFxBuses: buildFxBuses,
    deriveSegmentCue: deriveSegmentCue
  };
})();
`;

/**
 * Injects the recorder script into a preview document right before `</body>`
 * (or appends it when the document has no body tag), so the page evaluates it
 * on load and `window.__startMobileAgentVideoExport` can be called later.
 */
export function buildVideoExportDocument(html: string): string {
  const script = `\n<script>${VIDEO_AUDIO_ANALYSIS_SCRIPT}</script>\n<script>${VIDEO_CLIP_TIMELINE_SCRIPT}</script>\n<script>${VIDEO_CHROMA_KEY_SCRIPT}</script>\n<script>${VIDEO_EXPORT_SCRIPT}</script>\n`;
  const lower = html.toLowerCase();
  const index = lower.lastIndexOf("</body>");
  if (index === -1) return `${html}${script}`;
  return `${html.slice(0, index)}${script}${html.slice(index)}`;
}
