import { useState, useEffect, useRef, useCallback } from 'react'
import { Stream } from '@cloudflare/stream-react'
import { supabase } from '../lib/supabase'
import { subscribeUploads } from '../lib/uploadManager'
import styles from './Gallery.module.css'
import uploadStyles from './UploadForm.module.css'

function PhotoCard({ photo, index, isAdmin, onEdit, onDelete }) {
  const [loaded, setLoaded]         = useState(false)
  const [expanded, setExpanded]     = useState(false)
  const [isPortrait, setIsPortrait] = useState(false)
  const [isEditing, setIsEditing]   = useState(false)
  const [editCaption, setEditCaption]   = useState(photo.caption || '')
  const [editNote, setEditNote]         = useState(photo.note || '')
  const [editUploader, setEditUploader] = useState(photo.uploader_name || '')
  const [isSaving, setIsSaving]         = useState(false)

  // Zoom state
  const [zoom, setZoom]     = useState(1)
  const [pan, setPan]       = useState({ x: 0, y: 0 })
  const isDragging          = useRef(false)
  const dragStart           = useRef({ x: 0, y: 0 })
  const panStart            = useRef({ x: 0, y: 0 })
  const imgRef              = useRef(null)

  const MIN_ZOOM = 1
  const MAX_ZOOM = 5

  // Lock/unlock body scroll (prevents gallery behind from scrolling on mobile while panning)
  function lockScroll()   { document.body.style.overflow = 'hidden' }
  function unlockScroll() { document.body.style.overflow = '' }

  function clampPan(newPan, currentZoom, el) {
    if (!el || currentZoom <= 1) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const maxX = (rect.width  * (currentZoom - 1)) / 2
    const maxY = (rect.height * (currentZoom - 1)) / 2
    return {
      x: Math.max(-maxX, Math.min(maxX, newPan.x)),
      y: Math.max(-maxY, Math.min(maxY, newPan.y)),
    }
  }

  function applyZoom(delta, originX, originY) {
    setZoom(prev => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta))
      if (next === prev) return prev
      if (next <= 1) { setPan({ x: 0, y: 0 }); return 1 }
      return next
    })
  }

  function onWheel(e) {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.3 : -0.3
    applyZoom(delta)
  }

  function onImgClick(e) {
    e.stopPropagation()
    if (isDragging.current) return
    setZoom(prev => {
      if (prev > 1) { setPan({ x: 0, y: 0 }); return 1 }
      return 2
    })
  }

  function onMouseDown(e) {
    if (zoom <= 1) return
    e.preventDefault()
    isDragging.current = false
    dragStart.current  = { x: e.clientX, y: e.clientY }
    panStart.current   = { ...pan }
    const onMove = (ev) => {
      const dx = ev.clientX - dragStart.current.x
      const dy = ev.clientY - dragStart.current.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging.current = true
      setPan(clampPan({ x: panStart.current.x + dx, y: panStart.current.y + dy }, zoom, imgRef.current))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function resetZoom() {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    isDragging.current = false
  }

  // ── Touch support ──────────────────────────────────────────────
  const lastTapTime   = useRef(0)
  const touchStart    = useRef({ x: 0, y: 0 })
  const touchPanStart = useRef({ x: 0, y: 0 })
  const pinchStart    = useRef(null) // { dist, zoom, pan }

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  function onTouchStart(e) {
    if (e.touches.length === 1) {
      const t = e.touches[0]
      touchStart.current    = { x: t.clientX, y: t.clientY }
      touchPanStart.current = { ...pan }
      isDragging.current    = false

      // Double-tap to toggle zoom
      const now = Date.now()
      if (now - lastTapTime.current < 300) {
        e.preventDefault()
        setZoom(prev => {
          if (prev > 1) { setPan({ x: 0, y: 0 }); return 1 }
          return 2
        })
        lastTapTime.current = 0
      } else {
        lastTapTime.current = now
      }
    } else if (e.touches.length === 2) {
      e.preventDefault()
      pinchStart.current = {
        dist: getTouchDist(e.touches),
        zoom,
        pan: { ...pan },
      }
    }
  }

  function onTouchMove(e) {
    if (e.touches.length === 2 && pinchStart.current) {
      e.preventDefault()
      lockScroll()
      const newDist  = getTouchDist(e.touches)
      const scale    = newDist / pinchStart.current.dist
      const newZoom  = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStart.current.zoom * scale))
      setZoom(newZoom)
      if (newZoom <= 1) { setPan({ x: 0, y: 0 }); unlockScroll() }
    } else if (e.touches.length === 1) {
      const t  = e.touches[0]
      const dx = t.clientX - touchStart.current.x
      const dy = t.clientY - touchStart.current.y
      if (zoom <= 1) return   // let browser handle natural scroll
      e.preventDefault()
      lockScroll()
      isDragging.current = true
      setPan(clampPan(
        { x: touchPanStart.current.x + dx, y: touchPanStart.current.y + dy },
        zoom,
        imgRef.current
      ))
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) pinchStart.current = null
    isDragging.current = false
    unlockScroll()
  }

  const isVideo = photo.image_url.match(/\.(mp4|mov|webm)(\?.*)?$/i)
  const isCloudflareStream = photo.image_url.startsWith('cloudflare-stream:')
  let streamUid = isCloudflareStream ? photo.image_url.split(':')[1] : null
  if (streamUid && streamUid.includes('?')) {
    streamUid = streamUid.split('?')[0]
  }

  // Subtle random tilt — feels handmade
  const tilt = ((photo.id?.charCodeAt?.(0) || index) % 5 - 2) * 0.6

  // Detect portrait/landscape from thumbnail before opening lightbox
  function openLightbox() {
    if (isCloudflareStream && streamUid) {
      const img = new Image()
      img.onload = () => setIsPortrait(img.naturalHeight > img.naturalWidth)
      img.onerror = () => setIsPortrait(false)
      img.src = `https://videodelivery.net/${streamUid}/thumbnails/thumbnail.jpg?width=480`
    }
    resetZoom()
    setExpanded(true)
  }

  return (
    <>
      <div
        className={styles.card}
        style={{ '--tilt': `${tilt}deg`, animationDelay: `${(index % 12) * 40}ms` }}
        onClick={openLightbox}
      >
        <div className={styles.imgWrap}>
          {!loaded && !isCloudflareStream && <div className={styles.imgSkeleton} />}
          {isCloudflareStream ? (
            <div className={`${styles.img} ${styles.imgLoaded}`} style={{ width: '100%', aspectRatio: '16/9', overflow: 'hidden', position: 'relative' }}>
              <img
                src={`https://videodelivery.net/${streamUid}/thumbnails/thumbnail.jpg?width=480`}
                alt={photo.caption || 'Video'}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => { e.target.style.display = 'none' }}
              />
              <div className={styles.playOverlay}>
                <div className={styles.playIcon}>▶</div>
              </div>
            </div>
          ) : isVideo ? (
            <video
              src={photo.image_url}
              autoPlay
              loop
              muted
              playsInline
              onLoadedData={() => setLoaded(true)}
              className={`${styles.img} ${loaded ? styles.imgLoaded : ''}`}
            />
          ) : (
            <img
              src={photo.image_url}
              alt={photo.caption || 'Memory'}
              onLoad={() => setLoaded(true)}
              className={`${styles.img} ${loaded ? styles.imgLoaded : ''}`}
            />
          )}
        </div>
        {(photo.caption || photo.uploader_name) && (
          <div className={styles.cardBody}>
            {photo.caption && (
              <p className={styles.caption}>{photo.caption}</p>
            )}
            {photo.uploader_name && (
              <p className={styles.uploader}>— {photo.uploader_name}</p>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className={styles.lightbox} onClick={() => { setExpanded(false); setIsEditing(false); resetZoom(); unlockScroll(); }}>
        <div
          className={`${styles.lightboxInner} ${(isCloudflareStream || isVideo) ? (isPortrait ? styles.lightboxPortrait : styles.lightboxVideo) : styles.lightboxImage}`}
          onClick={e => e.stopPropagation()}
        >
          <button className={styles.closeBtn} onClick={() => { setExpanded(false); setIsEditing(false); resetZoom(); unlockScroll(); }}>✕</button>
          {isCloudflareStream ? (
            <div className={isPortrait ? styles.streamWrapPortrait : styles.streamWrap}>
                <iframe
                  src={`https://iframe.cloudflarestream.com/${streamUid}?autoplay=true&controls=true`}
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                  allowFullScreen
                  className={styles.streamPlayer}
                  title={photo.caption || 'Video'}
                />
              </div>
          ) : isVideo ? (
            <video src={photo.image_url} controls autoPlay loop className={styles.lightboxImg} />
          ) : (
            <div
              className={styles.zoomWrap}
              onWheel={onWheel}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              style={{ cursor: zoom > 1 ? (isDragging.current ? 'grabbing' : 'grab') : 'zoom-in' }}
            >
              <img
                ref={imgRef}
                src={photo.image_url}
                alt={photo.caption || 'Memory'}
                className={styles.lightboxImg}
                onClick={onImgClick}
                onMouseDown={onMouseDown}
                draggable={false}
                style={{
                  transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                  transition: isDragging.current ? 'none' : 'transform 0.2s ease',
                  userSelect: 'none',
                }}
              />
              <div className={styles.zoomControls}>
                <button className={styles.zoomBtn} onClick={e => { e.stopPropagation(); applyZoom(0.5) }} title="Zoom in">＋</button>
                <span className={styles.zoomHint}>{zoom > 1 ? 'Drag to pan' : 'Pinch or scroll to zoom'}</span>
                <button className={styles.zoomBtn} onClick={e => { e.stopPropagation(); applyZoom(-0.5) }} title="Zoom out">－</button>
                {zoom > 1 && <button className={styles.zoomBtn} onClick={e => { e.stopPropagation(); resetZoom() }} title="Reset">⊘</button>}
              </div>
            </div>
          )}
          <div className={styles.lightboxMeta}>
              {isEditing ? (
                <>
                  <input className={styles.editInput} value={editUploader} onChange={e => setEditUploader(e.target.value)} placeholder="Uploader Name" />
                  <input className={styles.editInput} value={editCaption} onChange={e => setEditCaption(e.target.value)} placeholder="Caption" />
                  <textarea className={styles.editTextarea} value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Note" rows={3} />
                  <div className={styles.adminActions}>
                    <button className={styles.adminBtn} disabled={isSaving} onClick={async () => {
                      setIsSaving(true)
                      const updates = {
                        uploader_name: editUploader.trim() || null,
                        caption: editCaption.trim() || null,
                        note: editNote.trim() || null,
                      }
                      const { error } = await supabase.from('photos').update(updates).eq('id', photo.id)
                      if (error) {
                        console.error("Failed to update memory:", error)
                        alert("Update failed. You may not have database permissions.")
                      } else {
                        onEdit(photo.id, updates)
                        setIsEditing(false)
                      }
                      setIsSaving(false)
                    }}>{isSaving ? 'Saving...' : 'Save'}</button>
                    <button className={styles.adminBtn} onClick={() => setIsEditing(false)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  {photo.caption && <p className={styles.lightboxCaption}>{photo.caption}</p>}
                  {photo.note && <p className={styles.lightboxNote}>{photo.note}</p>}
                  {photo.uploader_name && <p className={styles.lightboxUploader}>— {photo.uploader_name}</p>}
                  {photo.created_at && (
                    <p className={styles.lightboxDate}>
                      {new Date(photo.created_at).toLocaleDateString('en-US', {
                        month: 'long', day: 'numeric', year: 'numeric'
                      })}
                    </p>
                  )}
                  {isAdmin && (
                    <div className={styles.adminActions}>
                      <button className={styles.adminBtn} onClick={() => setIsEditing(true)}>Edit</button>
                      <button className={styles.adminBtn} onClick={async () => {
                        if (window.confirm("Delete this memory?")) {
                          // 1. Attempt to delete the actual file/video first (non-blocking)
                          try {
                            if (photo.image_url) {
                              if (photo.image_url.startsWith('cloudflare-stream:')) {
                                let videoId = photo.image_url.split(':')[1]
                                if (videoId.includes('?')) videoId = videoId.split('?')[0]
                                await supabase.functions.invoke('cloudflare-delete-video', {
                                  body: { videoId }
                                })
                              } else if (photo.image_url.includes('/memory-wall/')) {
                                const urlParts = photo.image_url.split('/memory-wall/')
                                if (urlParts.length > 1) {
                                  let fileName = urlParts[1]
                                  if (fileName.includes('?')) fileName = fileName.split('?')[0]
                                  await supabase.storage.from('memory-wall').remove([fileName])
                                }
                              }
                            }
                          } catch (cleanupErr) {
                            console.warn("Failed to clean up storage file, but proceeding with DB delete:", cleanupErr)
                          }
                          
                          // 2. Delete the database row
                          try {
                            setExpanded(false) // Close UI immediately
                            const { error: dbErr } = await supabase.from('photos').delete().eq('id', photo.id)
                            if (dbErr) {
                              console.error("Error deleting from DB:", dbErr)
                              alert("Failed to delete memory. You may not have permissions.")
                              setExpanded(true) // Re-open if it failed
                            } else {
                              onDelete(photo.id)
                            }
                          } catch (sysErr) {
                            console.error("Error during deletion:", sysErr)
                            alert("System error during delete.")
                            setExpanded(true)
                          }
                        }
                      }}>Delete</button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function Gallery({ onUpload, isAdmin }) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [newCount, setNewCount] = useState(0)
  const [activeUploads, setActiveUploads] = useState(new Map())
  const channelRef = useRef(null)

  function handleEdit(id, updates) {
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
  }

  function handleDelete(id) {
    setPhotos(prev => prev.filter(p => p.id !== id))
  }

  useEffect(() => {
    fetchPhotos()
    const unsub = subscribeUploads(setActiveUploads)
    channelRef.current = supabase
      .channel('photos-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'photos',
      }, payload => {
        setPhotos(prev => [payload.new, ...prev])
        setNewCount(n => n + 1)
        setTimeout(() => setNewCount(n => Math.max(0, n - 1)), 4000)
      })
      .subscribe()

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [])

  async function fetchPhotos() {
    const { data, error } = await supabase
      .from('photos')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error && data) setPhotos(data)
    setLoading(false)
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading memories…</p>
      </div>
    )
  }

  if (photos.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>✦</div>
        <h2 className={styles.emptyTitle}>The wall is waiting</h2>
        <p className={styles.emptyText}>Be the first to share a memory.</p>
        <button className={styles.emptyBtn} onClick={onUpload}>
          Add the first photo
        </button>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>
          {photos.length} {photos.length === 1 ? 'memory' : 'memories'} shared
        </h1>
        {newCount > 0 && (
          <span className={styles.newBadge}>
            +{newCount} new
          </span>
        )}
        <button className={styles.addBtn} onClick={onUpload}>
          + Add yours
        </button>
      </div>

      <div className={styles.masonry}>
        {/* Background-upload processing cards */}
        {[...activeUploads.values()]
          .filter(u => u.status !== 'done' && u.status !== 'error')
          .map(u => {
            const statusLabel = {
              encoding: `Preparing your video — ${u.encodeProgress ?? 0}%`,
              uploading: u.speed > 0
                ? `Uploading — ${(u.speed / 1024 / 1024).toFixed(1)} MB/s · ${u.eta > 0 ? Math.ceil(u.eta) + 's left' : '...'}`
                : `Uploading — ${u.progress ?? 0}%`,
              processing: 'Processing on server…',
              saving: 'Saving…',
            }[u.status] || 'Uploading…'
            return (
              <div key={u.id} className={uploadStyles.processingCard}>
                {u.preview && (
                  <img src={u.preview} alt="Your upload" className={uploadStyles.processingThumb} />
                )}
                <div className={uploadStyles.processingBadge}>
                  <div className={uploadStyles.processingSpinner} />
                  <span>{u.caption || u.name || 'Your memory'}</span>
                  <span className={uploadStyles.processingStatus}>{statusLabel}</span>
                </div>
              </div>
            )
          })
        }
        {photos.map((photo, i) => (
          <PhotoCard key={photo.id} photo={photo} index={i} isAdmin={isAdmin} onEdit={handleEdit} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  )
}
