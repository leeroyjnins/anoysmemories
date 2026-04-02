import { useState, useRef, useCallback } from 'react'
import * as tus from 'tus-js-client'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { supabase } from '../lib/supabase'
import { addUpload, updateUpload, removeUpload } from '../lib/uploadManager'
import styles from './UploadForm.module.css'

// ─── Limits ────────────────────────────────────────────────────────────────
const isMobile = () => window.innerWidth <= 768 || /Mobi|Android/i.test(navigator.userAgent)
const MAX_MB   = () => isMobile() ? 80   : 500
const MAX_SECS = () => isMobile() ? 60   : 180
const ENC_RES  = () => isMobile() ? 720  : 1080
const ENC_KBPS = () => isMobile() ? 3000 : 8000

// ─── FFmpeg singleton ───────────────────────────────────────────────────────
let ffmpegInstance = null
async function getFFmpeg(onProgress) {
  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg()
  }
  if (!ffmpegInstance.loaded) {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
    ffmpegInstance.on('progress', ({ progress }) => {
      onProgress(Math.round(progress * 100))
    })
    await ffmpegInstance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`,   'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
  } else {
    // Re-attach progress listener
    ffmpegInstance.off('progress')
    ffmpegInstance.on('progress', ({ progress }) => {
      onProgress(Math.round(progress * 100))
    })
  }
  return ffmpegInstance
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function formatEta(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `${Math.ceil(seconds)}s remaining`
  return `${Math.ceil(seconds / 60)}m remaining`
}
// ─── Thresholds ────────────────────────────────────────────────────────────
const SKIP_ENCODE_MB  = 150   // Skip encode below this if codec is H.264
const FORCE_ENCODE_MB = 250   // Always encode above this

// ─── Codec detection via ftyp box (first 256 bytes) ───────────────────────
async function detectVideoCodec(file) {
  try {
    const buf   = await file.slice(0, 256).arrayBuffer()
    const b     = new Uint8Array(buf)
    // ftyp major brand is at bytes 8-11
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).trim()
    const ext   = file.name.split('.').pop().toLowerCase()
    if (['hvc1','hev1','heic','mif1'].includes(brand))             return 'hevc'
    if (brand === 'av01')                                          return 'av1'
    if (ext === 'mov' && brand === 'qt  ')                        return 'prores'
    if (['avc1','isom','iso2','mp41','mp42','f4v '].includes(brand)) return 'h264'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

// ─── Smart encode decision ─────────────────────────────────────────────────
async function shouldEncode(file) {
  const sizeMB = file.size / (1024 * 1024)
  const ext    = file.name.split('.').pop().toLowerCase()
  // WebM — skip, Cloudflare handles VP8/VP9 natively
  if (ext === 'webm') return false
  // Rule 1: large file → always encode
  if (sizeMB > FORCE_ENCODE_MB) return true
  // Rule 2: small file → skip if H.264
  if (sizeMB < SKIP_ENCODE_MB) {
    const codec = await detectVideoCodec(file)
    return codec === 'hevc' || codec === 'prores' || codec === 'av1'
  }
  // Mid-range (150–250 MB): encode unless confirmed H.264
  const codec = await detectVideoCodec(file)
  return codec !== 'h264'
}
function getVideoDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src)
      resolve(video.duration)
    }
    video.onerror = () => resolve(null)
    video.src = URL.createObjectURL(file)
  })
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function UploadForm({ onSuccess }) {
  const [file, setFile]               = useState(null)
  const [preview, setPreview]         = useState(null)
  const [isVideo, setIsVideo]         = useState(false)
  const [name, setName]               = useState('')
  const [caption, setCaption]         = useState('')
  const [note, setNote]               = useState('')
  const [error, setError]             = useState(null)
  const [cellularWarning, setCellularWarning] = useState(null) // { sizeMb }
  const [phase, setPhase]             = useState('idle') // idle | encoding | uploading | saving | done
  const [encodeProgress, setEncodeProgress] = useState(0) // 0-100
  const [uploadProgress, setUploadProgress] = useState(0) // 0-100
  const [speed, setSpeed]             = useState(0)  // bytes/s
  const [eta, setEta]                 = useState(0)  // seconds
  const fileInputRef = useRef(null)
  const speedSamples = useRef([])
  const lastProgressRef = useRef({ bytes: 0, time: Date.now() })

  // ─── File pick ─────────────────────────────────────────────────────────────
  const handleFileChange = useCallback(async (e) => {
    const chosen = e.target.files?.[0]
    if (!chosen) return

    setError(null)
    setCellularWarning(null)

    const maxMb = MAX_MB()
    if (chosen.size > maxMb * 1024 * 1024) {
      setError(`File too large. Max ${maxMb} MB on this device.`)
      return
    }

    // Duration check for video
    if (chosen.type.startsWith('video/')) {
      const duration = await getVideoDuration(chosen)
      const maxSecs = MAX_SECS()
      if (duration !== null && duration > maxSecs) {
        setError(`Video too long. Max ${maxSecs}s on this device (yours is ${Math.round(duration)}s).`)
        return
      }

      // Cellular nudge — non-blocking
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
      if (conn?.type === 'cellular') {
        setCellularWarning({ sizeMb: (chosen.size / 1024 / 1024).toFixed(1) })
      }
    }

    setFile(chosen)
    const url = URL.createObjectURL(chosen)
    setPreview(url)
    setIsVideo(chosen.type.startsWith('video/'))
  }, [])

  // ─── Remove file ───────────────────────────────────────────────────────────
  function removeFile() {
    setFile(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setIsVideo(false)
    setCellularWarning(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ─── Speed tracking ────────────────────────────────────────────────────────
  function trackSpeed(bytesUploaded, bytesTotal) {
    const now = Date.now()
    const ref  = lastProgressRef.current
    const dt   = (now - ref.time) / 1000
    if (dt < 0.5) return
    const bps  = (bytesUploaded - ref.bytes) / dt
    lastProgressRef.current = { bytes: bytesUploaded, time: now }

    // Rolling 3-sample average
    speedSamples.current.push(bps)
    if (speedSamples.current.length > 3) speedSamples.current.shift()
    const avgBps = speedSamples.current.reduce((a, b) => a + b, 0) / speedSamples.current.length
    setSpeed(avgBps)

    const remaining = bytesTotal - bytesUploaded
    setEta(remaining / avgBps)
    setUploadProgress(Math.round((bytesUploaded / bytesTotal) * 100))
  }

  // ─── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) return

    setError(null)
    speedSamples.current = []
    lastProgressRef.current = { bytes: 0, time: Date.now() }

    const uploadId = `upload-${Date.now()}`
    const localPreview = preview
    const metaName    = name.trim() || null
    const metaCaption = caption.trim() || null
    const metaNote    = note.trim() || null

    addUpload(uploadId, {
      preview: localPreview,
      name: metaName,
      caption: metaCaption,
      note: metaNote,
      status: 'uploading',
    })

    // Stay on page — await the full upload, then navigate
    setPhase('uploading')
    setUploadProgress(0)
    setEncodeProgress(0)
    setSpeed(0)
    setEta(0)

    await runUpload({
      uploadId, file, localPreview, metaName, metaCaption, metaNote,
    })
  }

  // ─── Background upload runner ──────────────────────────────────────────────
  async function runUpload({ uploadId, file, localPreview, metaName, metaCaption, metaNote }) {
    try {
      const ext = file.name.split('.').pop().toLowerCase()
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      let finalImageUrl = ''
      let uploadFile = file

      if (file.type.startsWith('video/')) {
        // ── Smart encode decision ─────────────────────────────────────────
        const encode = await shouldEncode(file)

        if (encode) {
          // ── Encode with ffmpeg ────────────────────────────────────────────
          setPhase('encoding')
          updateUpload(uploadId, { status: 'encoding', progress: 0 })
          try {
            const ffmpeg = await getFFmpeg((p) => {
              setEncodeProgress(p)
              updateUpload(uploadId, { encodeProgress: p })
            })
            const inputName  = `in.${ext}`
            const outputName = `out.mp4`
            const res  = ENC_RES()
            const kbps = ENC_KBPS()
            await ffmpeg.writeFile(inputName, await fetchFile(file))
            await ffmpeg.exec([
              '-i', inputName,
              '-vf', `scale=-2:${res}`,
              '-c:v', 'libx264',
              '-b:v', `${kbps}k`,
              '-maxrate', `${kbps}k`,
              '-bufsize', `${kbps * 2}k`,
              '-preset', 'fast',
              '-movflags', '+faststart',
              '-c:a', 'aac',
              '-b:a', '128k',
              outputName,
            ])
            const data = await ffmpeg.readFile(outputName)
            uploadFile = new File([data.buffer], `encoded.mp4`, { type: 'video/mp4' })
            await ffmpeg.deleteFile(inputName)
            await ffmpeg.deleteFile(outputName)
          } catch (encErr) {
            console.warn('[upload] ffmpeg failed, uploading raw:', encErr)
            uploadFile = file
          }
        } else {
          // ── Skip encoding — upload as-is ─────────────────────────────────
          console.info('[upload] Skipping encode: file is small / already H.264')
        }

        // ── TUS upload to Cloudflare Stream ───────────────────────────────
        setPhase('uploading')
        setEncodeProgress(100)
        setUploadProgress(0)
        updateUpload(uploadId, { status: 'uploading', encodeProgress: 100, progress: 0 })
        const { data: uploadUrlData, error: edgeErr } = await supabase.functions.invoke('cloudflare-upload-url', {
          body: { uploadLength: uploadFile.size },
        })
        if (edgeErr || !uploadUrlData?.uploadUrl) {
          throw new Error(edgeErr?.message || 'Failed to get upload URL')
        }

        let lastBytes = 0, lastTime = Date.now(), samples = []
        const videoUid = await new Promise((resolve, reject) => {
          const upload = new tus.Upload(uploadFile, {
            endpoint: uploadUrlData.uploadUrl,
            chunkSize: 5 * 1024 * 1024,
            retryDelays: [0, 3000, 5000, 10000],
            metadata: { filename: uploadFile.name, filetype: uploadFile.type },
            onProgress: (bytesUploaded, bytesTotal) => {
              const now = Date.now()
              const dt  = (now - lastTime) / 1000
              if (dt >= 0.5) {
                const bps = (bytesUploaded - lastBytes) / dt
                lastBytes = bytesUploaded; lastTime = now
                samples.push(bps)
                if (samples.length > 3) samples.shift()
                const avg = samples.reduce((a, b) => a + b, 0) / samples.length
                const remaining = bytesTotal - bytesUploaded
                setUploadProgress(Math.round((bytesUploaded / bytesTotal) * 100))
                setSpeed(avg)
                setEta(remaining / avg)
                updateUpload(uploadId, {
                  progress: Math.round((bytesUploaded / bytesTotal) * 100),
                  speed: avg,
                  eta: remaining / avg,
                })
              }
            },
            onSuccess: () => {
              const parts = upload.url.split('/')
              let uid = parts[parts.length - 1]
              if (uid.includes('?')) uid = uid.split('?')[0]
              resolve(uid)
            },
            onError: reject,
          })
          upload.start()
        })

        finalImageUrl = `cloudflare-stream:${videoUid}`
        updateUpload(uploadId, { status: 'processing', progress: 100 })
      } else {
        // ── Image — direct Supabase Storage upload ────────────────────────
        setPhase('uploading')
        updateUpload(uploadId, { status: 'uploading', progress: 0 })
        const { error: storageErr } = await supabase.storage
          .from('memory-wall')
          .upload(safeName, file, { cacheControl: '3600', upsert: false })
        if (storageErr) throw new Error(storageErr.message)

        const { data: urlData } = supabase.storage.from('memory-wall').getPublicUrl(safeName)
        finalImageUrl = urlData.publicUrl
        setUploadProgress(100)
        updateUpload(uploadId, { progress: 100 })
      }

      // ── DB insert ─────────────────────────────────────────────────────────
      setPhase('saving')
      updateUpload(uploadId, { status: 'saving' })
      const { error: dbErr } = await supabase.from('photos').insert({
        image_url: finalImageUrl,
        uploader_name: metaName,
        caption: metaCaption,
        note: metaNote,
      })
      if (dbErr) throw new Error(dbErr.message)

      // ── Done! ──────────────────────────────────────────────────────────────
      updateUpload(uploadId, { status: 'done' })
      setTimeout(() => removeUpload(uploadId), 5000)
      setPhase('done')

    } catch (err) {
      updateUpload(uploadId, { status: 'error', error: err.message })
      setError(err.message || 'Something went wrong. Please try again.')
      setPhase('idle')
    }
  }

  // ─── Reset form for another upload ─────────────────────────────────────────
  function reset() {
    setFile(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setIsVideo(false)
    setName('')
    setCaption('')
    setNote('')
    setPhase('idle')
    setEncodeProgress(0)
    setUploadProgress(0)
    setSpeed(0)
    setEta(0)
    setError(null)
    setCellularWarning(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ─── Done screen ──────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div className={styles.success}>
        <div className={styles.successIcon}>✦</div>
        <h2 className={styles.successTitle}>Memory shared!</h2>
        <p className={styles.successText}>Your photo is now on the wall.</p>
        <div className={styles.successActions}>
          <button className={styles.primaryBtn} onClick={onSuccess}>
            View the gallery
          </button>
          <button className={styles.ghostBtn} onClick={reset}>
            Add another
          </button>
        </div>
      </div>
    )
  }

  // ─── Active upload / encoding screen ──────────────────────────────────────
  const isUploading = phase === 'encoding' || phase === 'uploading' || phase === 'saving'

  return (
    <div className={styles.wrap}>
      <div className={styles.formHeader}>
        <h1 className={styles.formTitle}>Share a memory</h1>
        <p className={styles.formSub}>Add a Photo/Video and a few words about Anoy.</p>
      </div>

      {/* Cellular nudge */}
      {cellularWarning && (
        <div className={styles.cellularBanner}>
          <span>📶 You're on mobile data — this video is {cellularWarning.sizeMb} MB. Connect to WiFi for a faster upload?</span>
          <button className={styles.cellularDismiss} onClick={() => setCellularWarning(null)}>Dismiss</button>
        </div>
      )}

      {/* Upload progress panel — shown while actively uploading */}
      {isUploading && (
        <div className={styles.uploadPanel}>
          {preview && (
            <div className={styles.uploadThumbWrap}>
              {isVideo
                ? <video src={preview} muted playsInline className={styles.uploadThumb} />
                : <img src={preview} alt="Your upload" className={styles.uploadThumb} />
              }
            </div>
          )}
          <div className={styles.uploadInfo}>
            {phase === 'encoding' && (
              <>
                <div className={styles.phaseLabel}>
                  <span>Preparing your video</span>
                  <strong>{encodeProgress}%</strong>
                </div>
                <div className={styles.encodeBar}>
                  <div className={styles.encodeBarFill} style={{ width: `${encodeProgress}%` }} />
                </div>
              </>
            )}
            {phase === 'uploading' && (
              <>
                <div className={styles.phaseLabel}>
                  <span>Uploading</span>
                  <strong>{uploadProgress}%</strong>
                </div>
                <div className={styles.uploadBar}>
                  <div className={styles.uploadBarFill} style={{ width: `${uploadProgress}%` }} />
                </div>
                {speed > 0 && (
                  <div className={styles.speedRow}>
                    {(speed / 1024 / 1024).toFixed(1)} MB/s
                    {eta > 0 && ` · ${eta < 60 ? Math.ceil(eta) + 's' : Math.ceil(eta / 60) + 'm'} remaining`}
                  </div>
                )}
              </>
            )}
            {phase === 'saving' && (
              <div className={styles.phaseLabel}>
                <span>Saving to gallery…</span>
                <div className={styles.processingSpinner} />
              </div>
            )}
            <p className={styles.uploadNotice}>Please wait — don't close this page.</p>
          </div>
        </div>
      )}

      <form className={styles.form} onSubmit={handleSubmit}>
        {/* File picker — hidden during upload */}
        {!isUploading && (
          <div className={styles.photoField}>
            {preview ? (
              <div className={styles.previewWrap}>
                {isVideo
                  ? <video src={preview} autoPlay loop muted playsInline className={styles.preview} />
                  : <img src={preview} alt="Preview" className={styles.preview} />
                }
                <button type="button" className={styles.removeBtn} onClick={removeFile}>Remove</button>
              </div>
            ) : (
              <label className={styles.dropzone}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/mp4,video/quicktime,video/webm"
                  capture="environment"
                  onChange={handleFileChange}
                  className={styles.hiddenInput}
                />
                <div className={styles.dropzoneContent}>
                  <span className={styles.dropzoneIcon}>⊕</span>
                  <span className={styles.dropzonePrimary}>Tap to take or choose a photo or video</span>
                  <span className={styles.dropzoneSub}>
                    JPEG, PNG, HEIC, MP4, MOV · Max {MAX_MB()} MB · {MAX_SECS() < 60 ? `${MAX_SECS()}s` : `${MAX_SECS() / 60}m`} video
                  </span>
                </div>
              </label>
            )}
          </div>
        )}

        {error && <div className={styles.errorBanner}>{error}</div>}

        {/* Text fields — hidden during upload */}
        {!isUploading && (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="name">Your name</label>
              <input id="name" type="text" className={styles.input} placeholder="e.g. Maria Santos"
                value={name} onChange={e => setName(e.target.value)} maxLength={60} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="caption">
                Caption <span className={styles.optional}>optional</span>
              </label>
              <input id="caption" type="text" className={styles.input} placeholder="A short title for your photo"
                value={caption} onChange={e => setCaption(e.target.value)} maxLength={120} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="note">
                Memory or note <span className={styles.optional}>optional</span>
              </label>
              <textarea id="note" className={styles.textarea} placeholder="Write a message, a memory, or a wish…"
                value={note} onChange={e => setNote(e.target.value)} rows={4} maxLength={500} />
              <span className={styles.charCount}>{note.length}/500</span>
            </div>
          </>
        )}

        {!isUploading && (
          <button type="submit" className={styles.submitBtn} disabled={!file}>
            Share to the wall
          </button>
        )}
      </form>
    </div>
  )
}
