import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { config } from "../../config.js";

const THUMB_SIZE = 128;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function ensureAvatarsDir() {
  if (!existsSync(config.avatarsDir)) {
    mkdirSync(config.avatarsDir, { recursive: true });
  }
}

function getAvatarPath(pictureId: string, variant: "original" | "thumb", ext: string) {
  const suffix = variant === "original" ? `_original.${ext}` : "_thumb.jpg";
  return path.join(config.avatarsDir, `${pictureId}${suffix}`);
}

export function getProfilePictureUrl(pictureId: string | null): string | null {
  if (!pictureId) return null;
  return `/api/avatars/${pictureId}_thumb.jpg`;
}

function detectExtension(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return "gif";
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return "webp";
  throw Object.assign(new Error("Unsupported image format. Allowed: JPEG, PNG, GIF, WebP"), { statusCode: 400, code: "INVALID_IMAGE" });
}

export async function saveProfilePicture(buffer: Buffer, originalName: string): Promise<string> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw Object.assign(new Error("File too large. Maximum size is 20 MB"), { statusCode: 413, code: "FILE_TOO_LARGE" });
  }

  const ext = detectExtension(buffer);
  const pictureId = randomUUID();

  ensureAvatarsDir();

  const originalPath = getAvatarPath(pictureId, "original", ext);
  const thumbPath = getAvatarPath(pictureId, "thumb", ext);

  await sharp(buffer).toFile(originalPath);

  await sharp(buffer)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover", position: "centre" })
    .jpeg({ quality: 80 })
    .toFile(thumbPath);

  return pictureId;
}

export function deleteProfilePictureFiles(pictureId: string | null): void {
  if (!pictureId) return;

  for (const ext of ["jpg", "png", "gif", "webp"]) {
    for (const variant of ["original", "thumb"] as const) {
      const filePath = getAvatarPath(pictureId, variant, ext);
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
