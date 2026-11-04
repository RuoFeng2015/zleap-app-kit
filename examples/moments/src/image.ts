/**
 * 选图后在浏览器里压缩：预览图（最长边 720px 的 JPEG data URL）存进共享集合，所有同事都能看到；
 * 原图（最长边 1600px，≤ 4 MiB）可选上传到应用文件存储。
 *
 * 应用在沙箱里不能引用外部图片地址，也拿不到临时公开链接，所以列表里的图只能来自集合里的 data URL。
 */
const PREVIEW_EDGE = 720;
const ORIGINAL_EDGE = 1600;
const MAX_PREVIEW_CHARS = 190_000; // 集合 schema 限 200000 字符，文档 ≤ 256 KiB
const MAX_ORIGINAL_BYTES = 4 * 1024 * 1024;

async function decode(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(img: HTMLImageElement, edge: number): HTMLCanvasElement {
  const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function preparePhoto(file: File, withOriginal: boolean): Promise<{ preview: string; original: Blob | null }> {
  const img = await decode(file);
  let preview = '';
  for (const quality of [0.72, 0.55, 0.4, 0.3]) {
    preview = draw(img, PREVIEW_EDGE).toDataURL('image/jpeg', quality);
    if (preview.length <= MAX_PREVIEW_CHARS) break;
  }
  if (preview.length > MAX_PREVIEW_CHARS) throw new Error('图片太大，压缩后仍超过上限');
  let original: Blob | null = null;
  if (withOriginal) {
    original = await new Promise<Blob | null>((resolve) => draw(img, ORIGINAL_EDGE).toBlob(resolve, 'image/jpeg', 0.88));
    if (original && original.size > MAX_ORIGINAL_BYTES) original = null;
  }
  return { preview, original };
}
