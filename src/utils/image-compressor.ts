/**
 * Client-side image resizing and compression for member avatar photos.
 * Ensures member photos never consume excessive disk space in SQLite / disk storage.
 *
 * Targets:
 * - Max dimension: 512px (square center-cropped avatar or aspect-preserved fit)
 * - Format: image/jpeg
 * - Quality: 0.82 (typically 25 KB - 60 KB per photo)
 */

export interface ResizeOptions {
  maxDimension?: number;
  quality?: number;
  squareCrop?: boolean;
}

/**
 * Resizes and compresses an image File or Blob using HTML Canvas.
 * Safely falls back to the original file if canvas or image decoding fails.
 */
export async function compressMemberPhoto(
  file: File | Blob,
  options: ResizeOptions = {},
): Promise<File> {
  const maxDim = options.maxDimension ?? 512;
  const quality = options.quality ?? 0.82;
  const squareCrop = options.squareCrop ?? true;

  // Determine a reasonable filename
  const originalName = file instanceof File ? file.name : "photo.jpg";
  const baseName = originalName.replace(/\.[^/.]+$/, "");
  const outputFilename = `${baseName || "photo"}.jpg`;

  // If running in an environment without DOM/Canvas (e.g. some node test runs), return as-is
  if (typeof window === "undefined" || typeof document === "undefined" || !("createElement" in document)) {
    return file instanceof File
      ? file
      : new File([file], outputFilename, { type: "image/jpeg" });
  }

  return new Promise((resolve) => {
    const fallback = () => {
      if (file instanceof File) {
        resolve(file);
      } else {
        resolve(new File([file], outputFilename, { type: "image/jpeg" }));
      }
    };

    let objectUrl: string | null = null;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      return fallback();
    }

    const img = new Image();

    img.onload = () => {
      try {
        if (objectUrl) URL.revokeObjectURL(objectUrl);

        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;

        if (!naturalWidth || !naturalHeight) {
          return fallback();
        }

        let sx = 0;
        let sy = 0;
        let sWidth = naturalWidth;
        let sHeight = naturalHeight;
        let targetWidth = naturalWidth;
        let targetHeight = naturalHeight;

        if (squareCrop) {
          // Center crop to a 1:1 square
          const minSide = Math.min(naturalWidth, naturalHeight);
          sx = (naturalWidth - minSide) / 2;
          sy = (naturalHeight - minSide) / 2;
          sWidth = minSide;
          sHeight = minSide;

          targetWidth = Math.min(minSide, maxDim);
          targetHeight = targetWidth;
        } else {
          // Scale down proportionally if exceeding maxDim
          if (naturalWidth > maxDim || naturalHeight > maxDim) {
            if (naturalWidth >= naturalHeight) {
              targetWidth = maxDim;
              targetHeight = Math.round((naturalHeight * maxDim) / naturalWidth);
            } else {
              targetHeight = maxDim;
              targetWidth = Math.round((naturalWidth * maxDim) / naturalHeight);
            }
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return fallback();
        }

        // High quality downscaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        // Draw image onto canvas
        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return fallback();
            }
            const compressedFile = new File([blob], outputFilename, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          },
          "image/jpeg",
          quality,
        );
      } catch {
        fallback();
      }
    };

    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      fallback();
    };

    img.src = objectUrl;
  });
}
