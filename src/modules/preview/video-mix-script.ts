/**
 * In-page mix checker for the `previewMix` tool.
 *
 * The host loads the agent's scene (all assets inlined) wrapped with the
 * recorder script — evaluated but never started — plus this script. It reads
 * the scene's audio schedule through the recorder's own validation
 * (`window.__mobileAgentAudioEngine`, so preflight and export can never
 * disagree), decodes file cues once, renders the mix offline in bounded
 * windows, and posts back level numbers only (peak/RMS/clip and quiet ranges,
 * ducked ranges). The tool turns those numbers into an actionable warning.
 *
 * Windowing is the memory guard: `OfflineAudioContext.startRendering()` allocates
 * its entire output up front, so a full-timeline buffer would be hundreds of
 * MB on a long video (600 s of stereo float32 is ~230 MB). Each window renders
 * at most {@link MIX_WINDOW_SECONDS} (~17 MB) through the exporter's own
 * `deriveSegmentCue`, which means window edges behave exactly like export
 * segment edges (5 ms fades included). Decoded file buffers are still held for
 * the whole check — one decode per track, the same cost today's 45 s check
 * pays — so an extremely long soundtrack remains the memory ceiling.
 *
 * Plain ES5 string (no backticks, template markers, or backslashes) like the
 * recorder string, and Node-testable with DOM/audio stubs.
 */

/**
 * One offline-render window. Matches the export segment budget so a mix check
 * measures the same edges the MP4 will have. Keep it a whole number of
 * seconds: quiet-range buckets are aligned to window-local one-second steps,
 * so a fractional window would drift minute markers off absolute time.
 */
export const MIX_WINDOW_SECONDS = 45;

export const VIDEO_MIX_SCRIPT = `(function () {
  function post(payload) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (_) {}
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  // Appends an absolute range, merging across window seams so a clip that
  // straddles two windows is reported once.
  function addRange(list, start, end) {
    var last = list.length > 0 ? list[list.length - 1] : null;
    if (last && start - last.end < 0.1) {
      if (end > last.end) last.end = round1(end);
      return;
    }
    list.push({ start: round1(start), end: round1(end) });
  }

  // Levels for one rendered window. Every time reported here is shifted into
  // the full timeline by the window offset.
  function analyzeBuffer(rendered, offset, fallbackRate) {
    var channels = [];
    var count = Math.min(rendered.numberOfChannels, 2);
    var c;
    for (c = 0; c < count; c += 1) channels.push(rendered.getChannelData(c));
    var total = channels.length > 0 ? channels[0].length : 0;
    var rate = rendered.sampleRate > 0 ? rendered.sampleRate : fallbackRate;
    var peak = 0;
    var sumSq = 0;
    var clipped = [];
    var clipStart = -1;
    var i, ch;
    for (i = 0; i < total; i += 1) {
      var s = 0;
      for (ch = 0; ch < channels.length; ch += 1) s += channels[ch][i];
      s /= channels.length;
      var a = s < 0 ? -s : s;
      if (a > peak) peak = a;
      sumSq += s * s;
      if (a >= 1) {
        if (clipStart < 0) clipStart = i;
      } else if (clipStart >= 0) {
        clipped.push({ start: offset + clipStart / rate, end: offset + i / rate });
        clipStart = -1;
      }
    }
    if (clipStart >= 0) clipped.push({ start: offset + clipStart / rate, end: offset + total / rate });
    var quiet = [];
    var win = Math.max(1, Math.floor(rate));
    var w;
    for (w = 0; w < total; w += win) {
      var wpeak = 0;
      var wend = Math.min(total, w + win);
      for (i = w; i < wend; i += 1) {
        var t = 0;
        for (ch = 0; ch < channels.length; ch += 1) t += channels[ch][i];
        t /= channels.length;
        var ta = t < 0 ? -t : t;
        if (ta > wpeak) wpeak = ta;
      }
      if (wpeak < 0.02) {
        quiet.push({ start: round1(offset + w / rate), end: round1(offset + wend / rate) });
      }
    }
    return { peak: peak, sumSq: sumSq, samples: total, clipped: clipped, quiet: quiet };
  }

  function duckedFromSchedule(schedule) {
    var ducked = [];
    for (var i = 0; i < schedule.cues.length; i += 1) {
      var cue = schedule.cues[i];
      if (!cue.duckRanges || cue.duckRanges.length === 0 || !(cue.duckAmount < 1)) continue;
      for (var d = 0; d < cue.duckRanges.length; d += 1) {
        ducked.push({
          start: cue.duckRanges[d].start,
          end: cue.duckRanges[d].end,
          level: cue.duckAmount
        });
      }
    }
    return ducked;
  }

  // Renders [start, start + length) with the exporter's own cue derivation,
  // so a window's edges are the same sliced cues an export segment hears.
  function renderWindow(engine, schedule, decoded, start, length, duration, sampleRate) {
    var segEnd = start + length;
    var context = new OfflineAudioContext(2, Math.max(1, Math.ceil(length * sampleRate)), sampleRate);
    var master = context.createGain();
    master.gain.value = schedule.master;
    master.connect(context.destination);
    var buses = engine.buildFxBuses(context, master, schedule.fx);
    var handle = {
      context: context, master: master, decoded: decoded,
      voices: 0, voiceOverflow: false,
      fxReverb: buses.fxReverb, fxDelay: buses.fxDelay
    };
    for (var i = 0; i < schedule.cues.length; i += 1) {
      var cue = schedule.cues[i];
      if (!(cue.start + cue.duration > start) || !(cue.start < segEnd)) continue;
      var use = cue;
      if (start > 0 || length < duration) {
        use = engine.deriveSegmentCue(cue, start, segEnd);
        if (!use) continue;
      }
      var entry = null;
      if (cue.kind === 'file') {
        for (var d = 0; d < decoded.length; d += 1) {
          if (decoded[d].cue === cue) { entry = decoded[d]; break; }
        }
        if (!entry) continue;
      }
      engine.scheduleAudioCue(handle, use, 0, entry);
    }
    if (handle.voiceOverflow) {
      return Promise.reject(new Error('The soundtrack exceeds the supported simultaneous voice limit.'));
    }
    return context.startRendering();
  }

  var cancelled = false;

  window.__cancelMobileAgentMixCheck = function () {
    cancelled = true;
  };

  window.__startMobileAgentMixCheck = function (duration) {
    cancelled = false;
    var engine = window.__mobileAgentAudioEngine;
    if (!engine) {
      post({ type: 'mobileAgentMixError', message: 'The audio engine is unavailable in this preview.' });
      return;
    }
    var contract = window.MOBILE_AGENT_VIDEO;
    if (!contract) {
      post({ type: 'mobileAgentMixError', message: 'No scene contract was found in this preview.' });
      return;
    }
    var schedule = null;
    try {
      schedule = engine.readAudioSchedule(contract, duration);
    } catch (error) {
      post({ type: 'mobileAgentMixError', message: 'The audio schedule is invalid: ' + String((error && error.message) || error) });
      return;
    }
    if (!schedule || schedule.cues.length === 0) {
      post({ type: 'mobileAgentMixDone', stats: null, warnings: ['The scene has no audio schedule to check.'] });
      return;
    }
    if (typeof OfflineAudioContext === 'undefined') {
      post({ type: 'mobileAgentMixDone', stats: null, warnings: ['The mix cannot be checked on this device.'] });
      return;
    }
    var sampleRate = 48000;
    var warnings = [];
    var decoded = [];
    var decodeContext = null;
    try {
      // A one-frame context decodes at the render rate. AudioBuffers are not
      // bound to a context, so every window can schedule them.
      decodeContext = new OfflineAudioContext(2, 1, sampleRate);
    } catch (error) {
      post({ type: 'mobileAgentMixDone', stats: null, warnings: ['The mix cannot be checked on this device.'] });
      return;
    }
    var chain = Promise.resolve();
    schedule.cues.forEach(function (cue) {
      if (cue.kind !== 'file') return;
      chain = chain.then(function () {
        if (cancelled) return null;
        return fetch(cue.src).then(function (res) {
          if (!res.ok) throw new Error('fetch failed');
          return res.arrayBuffer();
        }).then(function (buf) {
          return decodeContext.decodeAudioData(buf);
        }).then(function (audioBuf) {
          decoded.push({ cue: cue, buffer: audioBuf, windowStart: 0 });
          return null;
        }).catch(function () {
          warnings.push('An audio file could not be decoded and was skipped from the check.');
          return null;
        });
      });
    });
    chain.then(function () {
      if (cancelled) return null;
      var windows = [];
      var start;
      for (start = 0; start < duration - 0.000001; start += ${MIX_WINDOW_SECONDS}) {
        windows.push({ start: start, length: Math.min(${MIX_WINDOW_SECONDS}, duration - start) });
      }
      if (windows.length === 0) windows.push({ start: 0, length: duration });
      var peak = 0;
      var sumSq = 0;
      var samples = 0;
      var clipped = [];
      var quiet = [];
      var run = Promise.resolve();
      windows.forEach(function (win) {
        run = run.then(function () {
          if (cancelled) return null;
          return renderWindow(engine, schedule, decoded, win.start, win.length, duration, sampleRate).then(function (rendered) {
            if (cancelled || !rendered) return null;
            var part = analyzeBuffer(rendered, win.start, sampleRate);
            if (part.peak > peak) peak = part.peak;
            sumSq += part.sumSq;
            samples += part.samples;
            for (var i = 0; i < part.clipped.length; i += 1) {
              addRange(clipped, part.clipped[i].start, part.clipped[i].end);
            }
            for (var q = 0; q < part.quiet.length; q += 1) quiet.push(part.quiet[q]);
            return null;
          });
        });
      });
      return run.then(function () {
        if (cancelled) return null;
        post({
          type: 'mobileAgentMixDone',
          stats: {
            peak: peak,
            rms: samples > 0 ? Math.sqrt(sumSq / samples) : 0,
            clipped: clipped.length > 0,
            clippedRanges: clipped,
            quietRanges: quiet,
            duckedRanges: duckedFromSchedule(schedule),
            duration: duration
          },
          warnings: warnings
        });
        return null;
      });
    }).catch(function (error) {
      if (cancelled) return null;
      post({ type: 'mobileAgentMixError', message: 'Mix check failed: ' + String((error && error.message) || error) });
      return null;
    });
  };
})();`;
