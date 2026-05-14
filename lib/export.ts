"use client";

import JSZip from "jszip";

function dataUrlToBlob(dataUrl: string): Blob {
  const byteString = atob(dataUrl.split(",")[1]);
  const mimeString = dataUrl.split(",")[0].split(":")[1].split(";")[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, "_");
}

interface ExportableResult {
  name: string;
  crop?: { dataUrl: string } | null;
  painted?: { dataUrl: string } | null;
}

export async function exportResultsToZip(results: ExportableResult[]): Promise<Blob> {
  const zip = new JSZip();
  const folder = zip.folder("PortraitStudio_Export");
  if (!folder) {
    throw new Error("Failed to create ZIP folder.");
  }

  for (const result of results) {
    const baseName = sanitizeFilename(result.name.replace(/\.[^/.]+$/, ""));

    if (result.crop?.dataUrl) {
      const blob = dataUrlToBlob(result.crop.dataUrl);
      folder.file(`${baseName}_crop.jpg`, blob);
    }

    if (result.painted?.dataUrl) {
      const blob = dataUrlToBlob(result.painted.dataUrl);
      folder.file(`${baseName}_painted.jpg`, blob);
    }
  }

  return zip.generateAsync({ type: "blob" });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
