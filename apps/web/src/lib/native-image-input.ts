export const NATIVE_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const NATIVE_IMAGE_ACCEPT = NATIVE_IMAGE_MIME_TYPES.join(",");
export const MAX_NATIVE_IMAGES = 4;
export const MAX_NATIVE_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_NATIVE_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;

export interface PendingNativeImage {
  localId: string;
  name: string;
  modality: "image";
  mimeType: string;
  size: number;
  data: string;
  previewUrl: string;
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("无法读取图像"));
    reader.onerror = () => reject(reader.error ?? new Error("无法读取图像"));
    reader.readAsDataURL(file);
  });
}

export async function readNativeImages(files: FileList | File[], existing: PendingNativeImage[] = []): Promise<PendingNativeImage[]> {
  const selected = [...files];
  if (existing.length + selected.length > MAX_NATIVE_IMAGES) throw new Error(`每轮最多添加 ${MAX_NATIVE_IMAGES} 张图像`);
  const supported = new Set<string>(NATIVE_IMAGE_MIME_TYPES);
  for (const file of selected) {
    if (!supported.has(file.type)) throw new Error(`不支持 ${file.type || "未知格式"}；请选择 PNG、JPEG、WebP 或 GIF`);
    if (file.size > MAX_NATIVE_IMAGE_BYTES) throw new Error(`${file.name} 超过 8 MB`);
  }
  if (existing.reduce((sum, item) => sum + item.size, 0) + selected.reduce((sum, file) => sum + file.size, 0) > MAX_NATIVE_IMAGE_TOTAL_BYTES) throw new Error("本轮图像总大小不能超过 20 MB");
  const additions = await Promise.all(selected.map(async (file): Promise<PendingNativeImage> => {
    const previewUrl = await fileDataUrl(file);
    return { localId: crypto.randomUUID(), name: file.name, modality: "image", mimeType: file.type, size: file.size, data: previewUrl.slice(previewUrl.indexOf(",") + 1), previewUrl };
  }));
  return [...existing, ...additions];
}

export function nativeImageUpload(image: PendingNativeImage) {
  return { name: image.name, modality: image.modality, mimeType: image.mimeType, size: image.size, data: image.data };
}

export function formatAttachmentSize(size: number): string {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}
