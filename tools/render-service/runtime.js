/**
 * Page-side harness for remote rendering.
 *
 * This is a port of the parts of `src/modules/preview/video-recorder.ts` that
 * define *identity* and *frame dispatch*, so a scene rendered here behaves the
 * same as one rendered on the device:
 *
 *   - `fnv1a` and `describeContract()` produce the SAME `sharedHash` / shot
 *     hashes as the device. That matters even though the cache is namespaced by
 *     encoder profile: it keeps "edit one shot, re-encode one shot" working on a
 *     render node, which is the entire point of the shot model.
 *   - `renderFrame()` dispatches to the owning shot, with the same
 *     "render() must not move a source video" guard.
 *
 * Deliberately NOT ported yet (v1): clip seeking and the audio schedule. Both
 * need the workspace asset pipeline, and both fail loudly rather than rendering
 * a silently wrong file. See README.md §Status.
 */

(() => {
  "use strict";

  const state = {
    canvas: null,
    saved: null,
    stage: null,
    shots: null,
    contract: null,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readContract() {
    const contract = window.MOBILE_AGENT_VIDEO;
    if (!contract) return null;
    const hasShots =
      Object.prototype.toString.call(contract.shots) === "[object Array]" &&
      contract.shots.length > 0;
    if (typeof contract.render !== "function" && !hasShots) return null;
    return contract;
  }

  /** FNV-1a, byte-identical to `fnv1a` in video-recorder.ts and hashDocumentKey. */
  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return "h" + ("0000000" + (hash >>> 0).toString(16)).slice(-8);
  }

  function contractShots(contract) {
    const raw = contract && contract.shots;
    if (Object.prototype.toString.call(raw) !== "[object Array]") return null;
    const out = [];
    for (let i = 0; i < raw.length; i += 1) {
      const shot = raw[i];
      if (!shot || typeof shot.render !== "function") continue;
      const start = Number(shot.start);
      const end = Number(shot.end);
      if (!isFinite(start) || !isFinite(end) || end <= start) continue;
      let source = "";
      try {
        source = shot.render.toString();
      } catch {
        source = "";
      }
      out.push({
        id: typeof shot.id === "string" && shot.id ? shot.id : "shot-" + (i + 1),
        start,
        end,
        render: shot.render,
        source,
      });
    }
    if (!out.length) return null;
    out.sort((a, b) => a.start - b.start || a.end - b.end);
    return out;
  }

  function shotAt(shots, t) {
    if (!shots) return null;
    for (const shot of shots) {
      if (t >= shot.start && t < shot.end) return shot;
    }
    return null;
  }

  function describeContract() {
    const contract = readContract();
    if (!contract) return null;
    const duration = clamp(Number(contract.duration) || 10, 1, 600);
    const fps = clamp(Number(contract.fps) || 30, 5, 60);
    const width = Math.round(clamp(Number(contract.width) || 1280, 160, 1920));
    const height = Math.round(clamp(Number(contract.height) || 720, 160, 1920));
    const shots = contractShots(contract);

    let documentText = "";
    try {
      documentText = document.documentElement ? document.documentElement.outerHTML : "";
    } catch {
      documentText = "";
    }

    const planShots = [];
    if (shots) {
      for (const shot of shots) {
        // Removing this shot's own source is what makes a one-shot edit leave
        // the shared hash alone; the shot hash carries the change instead.
        if (shot.source) documentText = documentText.split(shot.source).join("");
        planShots.push({
          id: shot.id,
          start: shot.start,
          end: shot.end,
          hash: fnv1a(shot.id + "\u0000" + shot.start + "\u0000" + shot.end + "\u0000" + shot.source),
        });
      }
    }

    return {
      duration,
      fps,
      width,
      height,
      sharedHash: fnv1a(documentText),
      shots: planShots,
    };
  }

  function resolveCanvas(contract) {
    let canvas = null;
    if (contract.canvasId) {
      const byId = document.getElementById(contract.canvasId);
      if (byId && byId.tagName === "CANVAS") canvas = byId;
    }
    if (!canvas) {
      const list = document.querySelectorAll("canvas");
      for (const candidate of list) {
        if (candidate.width > 0 || candidate.height > 0 || candidate.offsetWidth > 0) {
          canvas = candidate;
          break;
        }
      }
    }
    return canvas;
  }

  function stageCanvas(canvas, width, height) {
    state.saved = {
      parent: canvas.parentNode,
      nextSibling: canvas.nextSibling,
      style: canvas.getAttribute("style"),
      className: canvas.getAttribute("class"),
      width: canvas.width,
      height: canvas.height,
    };
    state.canvas = canvas;
    canvas.width = width;
    canvas.height = height;
    // Pixel-exact: the viewport is set to width x height, so the canvas fills
    // it and a CDP screenshot is the frame, with no letterboxing to crop.
    canvas.setAttribute(
      "style",
      `display:block;position:fixed;left:0;top:0;width:${width}px;height:${height}px;background:#000;`,
    );

    state.stage = document.createElement("div");
    state.stage.id = "mobile-agent-remote-stage";
    state.stage.setAttribute(
      "style",
      "position:fixed;inset:0;z-index:2147483647;background:#000;",
    );
    state.stage.appendChild(canvas);
    (document.body || document.documentElement).appendChild(state.stage);

    document.documentElement.style.margin = "0";
    document.documentElement.style.padding = "0";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.background = "#000";
    if (document.body) {
      document.body.style.margin = "0";
      document.body.style.padding = "0";
      document.body.style.overflow = "hidden";
    }
  }

  function unsupportedReason(contract) {
    if (contract.audio === undefined) {
      return (
        "The scene does not declare `audio`. Set `audio: false` for intentional " +
        "silence (or an audio schedule) so a missing soundtrack is never silent by accident."
      );
    }
    if (contract.audio && typeof contract.audio === "object") {
      return (
        "Audio schedules are not supported by this render node yet (v1 renders " +
        "silent video only). Render on-device, or remove the audio schedule."
      );
    }
    if (document.querySelector("video")) {
      return (
        "Video clips are not supported by this render node yet (v1 has no " +
        "workspace asset transport). Render on-device, or drop the clips."
      );
    }
    return null;
  }

  function awaitImages() {
    const images = document.querySelectorAll("img");
    const waits = [];
    for (const image of images) {
      if (image.complete) continue;
      if (typeof image.decode === "function") {
        waits.push(image.decode().catch(() => {}));
      } else {
        waits.push(
          new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          }),
        );
      }
    }
    return Promise.all(waits);
  }

  function renderFrame(t) {
    const contract = state.contract;
    const canvas = state.canvas;
    const ctx = canvas.getContext("2d");
    const shot = shotAt(state.shots, t);
    if (shot) {
      shot.render(t, canvas, ctx, null, null);
    } else if (typeof contract.render === "function") {
      contract.render(t, canvas, ctx, null, null);
    } else {
      throw new Error(
        "No shot covers t=" + t.toFixed(3) + "s and the contract has no render() fallback.",
      );
    }
  }

  window.__maReady = () => readContract() !== null;

  window.__maPlan = () => {
    const plan = describeContract();
    if (!plan) throw new Error("The page does not implement window.MOBILE_AGENT_VIDEO.");
    return plan;
  };

  window.__maSetup = () => {
    const contract = readContract();
    if (!contract) throw new Error("The page does not implement window.MOBILE_AGENT_VIDEO.");

    const reason = unsupportedReason(contract);
    if (reason) throw new Error(reason);

    const plan = describeContract();
    const canvas = resolveCanvas(contract);
    if (!canvas) {
      throw new Error("The scene has no <canvas> and no canvasId to resolve one.");
    }
    stageCanvas(canvas, plan.width, plan.height);
    state.contract = contract;
    state.shots = contractShots(contract);
    return plan;
  };

  window.__maFrame = async (t) => {
    if (!state.contract) throw new Error("__maSetup() has not run.");
    await awaitImages();
    renderFrame(t);
    return true;
  };

  /**
   * Render + encode one frame in a single round trip. Base64 JPEG is exactly
   * what the device captures, so the pixels match; the alternative
   * (Page.captureScreenshot) forces a compositor frame and costs a second
   * round trip per frame.
   */
  window.__maCapture = async (t, quality) => {
    if (!state.contract) throw new Error("__maSetup() has not run.");
    await awaitImages();
    renderFrame(t);
    const dataUrl = state.canvas.toDataURL("image/jpeg", quality);
    const comma = dataUrl.indexOf(",");
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  };

  /** Renderer actually in use; drives the `canvas` field of /v1/capabilities. */
  window.__maRendererInfo = () => {
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") || probe.getContext("webgl");
      if (!gl) return { renderer: "none", canvas: "cpu" };
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
      const software = /swiftshader|llvmpipe|software|basic render/i.test(String(renderer));
      return { renderer: String(renderer), canvas: software ? "cpu" : "gpu" };
    } catch (error) {
      return { renderer: String(error && error.message), canvas: "cpu" };
    }
  };
})();
