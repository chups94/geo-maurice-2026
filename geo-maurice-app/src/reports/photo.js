// Compression des photos dans l'appareil, avant tout envoi.
const MAX_SIDE = 1280;     // px, côté le plus long
const JPEG_QUALITY = 0.7;
const MAX_BYTES = 1.2 * 1024 * 1024;

/**
 * Redimensionne et ré-encode la photo en JPEG.
 * Le ré-encodage via <canvas> supprime toutes les métadonnées EXIF (dont le GPS).
 */
export async function compressPhoto(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const toBlob = (q) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
    let blob = await toBlob(JPEG_QUALITY);
    if (blob.size > MAX_BYTES) blob = await toBlob(0.5);
    return { blob, width: canvas.width, height: canvas.height };
}
