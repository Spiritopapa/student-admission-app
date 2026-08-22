/**
 * Cloudinary Configuration
 *
 * IMPORTANT: Replace the placeholders below with your actual Cloudinary values.
 *
 * 1. Create a free account at https://cloudinary.com and open your Dashboard.
 * 2. Copy your Cloud Name into CLOUDINARY_CLOUD_NAME below.
 * 3. Create an UNSIGNED upload preset:
 *      Cloudinary Dashboard → Settings → Upload → "Add upload preset"
 *      - Signing Mode: **Unsigned**  (lets the browser upload WITHOUT an API secret)
 *      - Default folder (optional): e.g. "online_v" or "student-admission-app"
 *      - Leave "Uses all the file types" / image/raw enabled so PDFs work too.
 *      Copy the preset name into CLOUDINARY_UPLOAD_PRESET below.
 *
 * These two values are PUBLIC (same idea as the Supabase anonymous key). The
 * upload preset controls allowed types/sizes, so NO secret is ever exposed to
 * the browser.
 *
 * CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must NEVER go in this file.
 * They are only used server-side by the Vercel serverless function
 * /api/cloudinary-delete (see .env.example) to delete replaced photos/documents.
 */

// ===== CONFIGURE THESE ========================================
const CLOUDINARY_CLOUD_NAME = 'ewr15dx6';
const CLOUDINARY_UPLOAD_PRESET = 'quan31i6';
// Optional human-friendly base folder used when uploading. The upload preset is
// SUGGESTED to use the same folder so all assets live in one place.
const CLOUDINARY_BASE_FOLDER = 'online_v';
// ==============================================================

if (
  CLOUDINARY_CLOUD_NAME === 'YOUR_CLOUD_NAME' ||
  CLOUDINARY_UPLOAD_PRESET === 'YOUR_UNSIGNED_UPLOAD_PRESET'
) {
  console.warn(
    '⚠️  Cloudinary not configured! Open js/cloudinary-config.js and set your ' +
      'CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET. The app will keep ' +
      'using Supabase Storage until then.'
  );
}

/**
 * True when Cloudinary has real values configured. Kept as a function so it is
 * evaluated at call-time (values never change at runtime, but this guards
 * against config being edited while the page is open).
 */
function isCloudinaryReady() {
  return (
    !!CLOUDINARY_CLOUD_NAME &&
    CLOUDINARY_CLOUD_NAME !== 'YOUR_CLOUD_NAME' &&
    !!CLOUDINARY_UPLOAD_PRESET &&
    CLOUDINARY_UPLOAD_PRESET !== 'YOUR_UNSIGNED_UPLOAD_PRESET'
  );
}

export {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_UPLOAD_PRESET,
  CLOUDINARY_BASE_FOLDER,
  isCloudinaryReady,
};