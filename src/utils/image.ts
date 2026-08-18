/**
 * iTerm2 Image Protocol Utilities
 *
 * Protocol format:
 * \x1b]1337;File=name=...;size=...;width=...;height=...;inline=1:base64_data\x07
 *
 * Reference: https://iterm2.com/documentation-images.html
 */

export interface ImageToProtocolOptions {
  /** Filename shown in terminal (optional, defaults to "image.png") */
  name?: string;
  /** Display width in cells (optional, auto-calculated from height if not provided) */
  width?: number;
  /** Display height in cells (optional, auto-calculated from width if not provided) */
  height?: number;
  /** Whether to display inline (always 1 for paste) */
  inline?: boolean;
  /** Content type (optional, auto-detected from data URL prefix) */
  type?: "png" | "jpeg" | "gif" | "webp";
}

const ITERM2_ESCAPE = "\x1b]1337;";
const ITERM2_TERMINATOR = "\x07";

/**
 * Convert a Blob/File to iTerm2 image protocol string
 */
export async function imageToProtocol(
  data: ArrayBuffer | Uint8Array,
  options: ImageToProtocolOptions = {}
): Promise<string> {
  const {
    name = "image.png",
    width,
    height,
    inline = true,
  } = options;

  // Convert to base64
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const base64 = uint8ArrayToBase64(bytes);
  const size = bytes.length;

  // Build metadata
  const metadata: string[] = [
    `name=${base64EncodeFileName(name)}`,
    `size=${size}`,
  ];

  if (width !== undefined) {
    metadata.push(`width=${width}`);
  }
  if (height !== undefined) {
    metadata.push(`height=${height}`);
  }
  if (inline) {
    metadata.push("inline=1");
  }

  return `${ITERM2_ESCAPE}File=${metadata.join(";")}:${base64}${ITERM2_TERMINATOR}`;
}

/**
 * Convert clipboard image data (Blob) to iTerm2 protocol
 */
export async function clipboardImageToProtocol(
  blob: Blob,
  options: ImageToProtocolOptions = {}
): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const detectedType = detectImageType(blob.type);
  return imageToProtocol(arrayBuffer, { ...options, type: detectedType || options.type || "png" });
}

/**
 * Convert File to protocol - convenience wrapper
 */
export async function fileToProtocol(
  file: File,
  options: ImageToProtocolOptions = {}
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const detectedType = detectImageType(file.type);
  return imageToProtocol(arrayBuffer, {
    ...options,
    name: file.name,
    type: detectedType || options.type || "png",
  });
}

// ============ Internal Helpers ============

function detectImageType(
  mimeType: string
): "png" | "jpeg" | "gif" | "webp" | undefined {
  const map: Record<string, "png" | "jpeg" | "gif" | "webp"> = {
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return map[mimeType];
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64EncodeFileName(name: string): string {
  return btoa(unescape(encodeURIComponent(name)));
}
