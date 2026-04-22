/**
 * Returns a Supabase image-transform URL for thumbnails.
 * Falls back to the original URL for non-storage or Cloudflare URLs.
 * @param {string} url - The original Supabase storage public URL
 * @param {number} width - Desired width in pixels
 * @returns {string}
 */
export function thumbUrl(url) {
  if (!url || !url.includes('/storage/v1/object/public/')) return url
  return (
    url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') +
    `?format=webp&quality=60`
  )
}
