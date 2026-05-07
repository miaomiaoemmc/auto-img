import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const cacheRoot = path.join(process.cwd(), ".gui-cache");
const uploadsRoot = path.join(cacheRoot, "uploads");

async function ensureUploadRoot() {
  await mkdir(uploadsRoot, { recursive: true });
}

function cleanExtension(filename) {
  const extension = path.extname(filename || "").toLowerCase();
  return extension || ".jpg";
}

export async function saveUpload(file) {
  await ensureUploadRoot();
  const extension = cleanExtension(file.name);
  const id = `${randomUUID()}${extension}`;
  const targetPath = path.join(uploadsRoot, id);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(targetPath, bytes);
  return { id, path: targetPath };
}

export async function resolveUploadPath(imageId) {
  await ensureUploadRoot();
  const safeId = path.basename(imageId || "");
  if (!safeId || safeId !== imageId) {
    throw new Error("Invalid image id.");
  }
  return path.join(uploadsRoot, safeId);
}
