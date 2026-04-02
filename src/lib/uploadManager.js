/**
 * Module-level singleton for background uploads.
 * Survives React component unmounts — the upload continues even if
 * UploadForm navigates away. Gallery subscribes to this to show
 * "Processing…" cards.
 */

/** @type {Map<string, {id:string, preview:string|null, name:string|null, caption:string|null, note:string|null, status:'uploading'|'processing'|'done'|'error', progress:number, speed:number, eta:number, error:string|null}>} */
const uploads = new Map()
const listeners = new Set()

function notify() {
  listeners.forEach(cb => cb(new Map(uploads)))
}

export function subscribeUploads(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getUploads() {
  return new Map(uploads)
}

export function addUpload(id, data) {
  uploads.set(id, { id, status: 'uploading', progress: 0, speed: 0, eta: 0, error: null, ...data })
  notify()
}

export function updateUpload(id, data) {
  if (!uploads.has(id)) return
  uploads.set(id, { ...uploads.get(id), ...data })
  notify()
}

export function removeUpload(id) {
  uploads.delete(id)
  notify()
}
