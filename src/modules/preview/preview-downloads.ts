import { Alert } from "react-native";
import { File, Paths } from "expo-file-system";
import type { WebViewMessageEvent } from "react-native-webview";

import { downloadFile } from "@/core/services/download-service";

export const PREVIEW_DOWNLOAD_HOOK = `(function () {
  if (window.__mobileAgentDownloadHook) return;
  window.__mobileAgentDownloadHook = true;

  function absoluteUrl(value) {
    try { return new URL(value, location.href).href; } catch (_) { return value; }
  }

  function filenameFrom(anchor, url) {
    var value = anchor.getAttribute('download');
    if (value) return value;
    try {
      var parsed = new URL(url, location.href);
      return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || 'download');
    } catch (_) {
      return 'download';
    }
  }

  function mimeTypeFrom(anchor, url, blobType) {
    if (anchor.type) return anchor.type;
    if (blobType) return blobType;
    var pathname = '';
    try { pathname = new URL(url, location.href).pathname.toLowerCase(); } catch (_) {}
    if (pathname.endsWith('.html') || pathname.endsWith('.htm')) return 'text/html';
    if (pathname.endsWith('.svg')) return 'image/svg+xml';
    if (pathname.endsWith('.csv')) return 'text/csv';
    if (pathname.endsWith('.json')) return 'application/json';
    if (pathname.endsWith('.pdf')) return 'application/pdf';
    return 'application/octet-stream';
  }

  function post(payload) {
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }

  function sendInline(anchor, url, filename, mimeType) {
    try {
      fetch(url).then(function (response) { return response.blob(); }).then(function (blob) {
        var mime = mimeTypeFrom(anchor, url, blob.type);
        var reader = new FileReader();
        reader.onloadend = function () {
          var value = String(reader.result || '');
          var base64 = value.split(',')[1] || '';
          post({ type: 'mobileAgentDownload', filename: filename, mimeType: mime, contentBase64: base64 });
        };
        reader.readAsDataURL(blob);
      }).catch(function (error) {
        post({ type: 'mobileAgentDownloadError', filename: filename, message: String(error) });
      });
    } catch (error) {
      post({ type: 'mobileAgentDownloadError', filename: filename, message: String(error) });
    }
  }

  function intercept(anchor) {
    if (!anchor || !anchor.hasAttribute('download')) return;
    var href = absoluteUrl(anchor.getAttribute('href') || '');
    if (!href) return;
    var filename = filenameFrom(anchor, href);
    var mimeType = mimeTypeFrom(anchor, href);
    if (href.indexOf('blob:') === 0 || href.indexOf('data:') === 0) {
      sendInline(anchor, href, filename, mimeType);
    } else {
      post({ type: 'mobileAgentDownload', url: href, filename: filename, mimeType: mimeType });
    }
  }

  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node.nodeType === 1) {
      if (node.tagName === 'A' && node.hasAttribute('download')) {
        event.preventDefault();
        event.stopPropagation();
        intercept(node);
        return;
      }
      node = node.parentNode;
    }
  }, true);

  var originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download')) {
      intercept(this);
      return;
    }
    return originalClick.apply(this, arguments);
  };
})();
true;
`;

type DownloadMessage =
  | { type: "mobileAgentDownload"; url?: string; filename?: string; mimeType?: string; contentBase64?: string }
  | { type: "mobileAgentDownloadError"; filename?: string; message?: string };

function isDownloadMessage(value: unknown): value is DownloadMessage {
  return typeof value === "object" && value !== null && "type" in value &&
    ((value as { type?: unknown }).type === "mobileAgentDownload" || (value as { type?: unknown }).type === "mobileAgentDownloadError");
}

function safeFileName(name?: string) {
  return (name || "download")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "download";
}

function extensionFor(name: string, mimeType: string) {
  if (/\.html?$/i.test(name)) return mimeType;
  if (/\.svg$/i.test(name)) return "image/svg+xml";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  return mimeType;
}

export async function handlePreviewDownloadMessage(event: WebViewMessageEvent) {
  let message: unknown;
  try {
    message = JSON.parse(event.nativeEvent.data);
  } catch {
    return;
  }

  if (!isDownloadMessage(message)) return;

  if (message.type === "mobileAgentDownloadError") {
    Alert.alert("Download failed", message.message ?? "The preview could not download that file.");
    return;
  }

  const filename = safeFileName(message.filename);
  const mimeType = extensionFor(filename, message.mimeType || "application/octet-stream");

  try {
    if (message.contentBase64) {
      const file = new File(Paths.cache, filename);
      file.create({ overwrite: true, intermediates: true });
      file.write(message.contentBase64, { encoding: "base64" });
      const result = await downloadFile(file.uri, filename, mimeType);
      file.delete();
      if (result) Alert.alert("Downloaded", `${result.name} has been saved to Downloads.`);
      return;
    }

    if (message.url) {
      if (/^(https?:)?\/\//i.test(message.url) || /^https?:\/\//i.test(message.url)) {
        const cached = await File.downloadFileAsync(message.url, new File(Paths.cache, filename));
        const result = await downloadFile(cached.uri, filename, mimeType);
        cached.delete();
        if (result) Alert.alert("Downloaded", `${result.name} has been saved to Downloads.`);
        return;
      }

      throw new Error("Only http(s), blob, and data download links are supported.");
    }
  } catch (error) {
    Alert.alert("Download failed", error instanceof Error ? error.message : "The download could not be completed.");
  }
}
