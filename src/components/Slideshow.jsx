import { useState, useEffect, useRef, useCallback } from 'react'
import { Stream } from '@cloudflare/stream-react'
import { supabase } from '../lib/supabase'
import { thumbUrl } from '../lib/utils'
import styles from './Slideshow.module.css'

function shuffleArray(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr
}

export default function Slideshow({ onClose }) {
  const [photos, setPhotos]         = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading]       = useState(true)
  const [started, setStarted]       = useState(false)
  const [isPortrait, setIsPortrait]  = useState(false)
  const [navVisible, setNavVisible]  = useState(true)
  const channelRef  = useRef(null)
  const timerRef    = useRef(null)
  const navTimerRef = useRef(null)

  // ─── Load + realtime ────────────────────────────────────────────────────────
  useEffect(() => {
    fetchPhotos()
    channelRef.current = supabase
      .channel('photos-slideshow-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'photos' },
        payload => setPhotos(prev => [...prev, payload.new])
      )
      .subscribe()
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      clearTimeout(timerRef.current)
      clearTimeout(navTimerRef.current)
    }
  }, [])

  async function fetchPhotos() {
    const { data, error } = await supabase
      .from('photos')
      .select('id, image_url, caption, uploader_name, note, created_at')
    if (!error && data) setPhotos(shuffleArray(data))
    setLoading(false)
  }

  // ─── Auto-advance for photos ──────────────────────────────────────────────
  useEffect(() => {
    if (photos.length === 0) return
    const p = photos[currentIndex]
    if (!p) return
    const isVid = p.image_url.match(/\.(mp4|mov|webm)(\?.*)?$/i)
    const isCf  = p.image_url.startsWith('cloudflare-stream:')
    clearTimeout(timerRef.current)
    if (!isVid && !isCf) {
      timerRef.current = setTimeout(advanceSlide, 7000)
    }
    return () => clearTimeout(timerRef.current)
  }, [currentIndex, photos])

  // ─── Portrait detection via thumbnail ────────────────────────────────────
  useEffect(() => {
    if (photos.length === 0) return
    const p = photos[currentIndex]
    if (!p) return
    const isCf  = p.image_url.startsWith('cloudflare-stream:')
    if (!isCf) { setIsPortrait(false); return }
    let uid = p.image_url.split(':')[1]
    if (uid?.includes('?')) uid = uid.split('?')[0]
    const img = new Image()
    img.onload  = () => setIsPortrait(img.naturalHeight > img.naturalWidth)
    img.onerror = () => setIsPortrait(false)
    img.src = `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg?width=480`
  }, [currentIndex, photos])

  // ─── Nav auto-hide ────────────────────────────────────────────────────────
  function showNav() {
    setNavVisible(true)
    clearTimeout(navTimerRef.current)
    navTimerRef.current = setTimeout(() => setNavVisible(false), 3000)
  }

  const advanceSlide = useCallback(() => {
    setCurrentIndex(prev => (prev + 1) % photos.length)
  }, [photos.length])

  function prevSlide() {
    setCurrentIndex(prev => (prev - 1 + photos.length) % photos.length)
    showNav()
  }
  function nextSlide() {
    setCurrentIndex(prev => (prev + 1) % photos.length)
    showNav()
  }

  // ─── Keyboard navigation ──────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowLeft')  prevSlide()
      if (e.key === 'ArrowRight') nextSlide()
      if (e.key === 'Escape')     onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photos.length])

  // ─── Loading / empty states ───────────────────────────────────────────────
  if (loading) return (
    <div className={styles.container}>
      <div className={styles.loading}>Loading memories…</div>
    </div>
  )
  if (photos.length === 0) return (
    <div className={styles.container}>
      <div className={styles.loading}>No memories yet. The wall is waiting.</div>
      <button className={styles.closeBtn} onClick={onClose}>✕</button>
    </div>
  )

  // ─── Start splash (user-gesture gate for autoplay-with-sound) ─────────────
  if (!started) return (
    <div className={styles.container}>
      <div className={styles.splash}>
        <div className={styles.splashRing}>
          <button
            className={styles.splashPlay}
            onClick={() => setStarted(true)}
            aria-label="Start slideshow"
          >
            ▶
          </button>
        </div>
        <p className={styles.splashLabel}>Tap to begin</p>
      </div>
      <button className={styles.closeBtn} onClick={onClose} aria-label="Exit">✕</button>
    </div>
  )

  const p       = photos[currentIndex]
  const isVid   = p.image_url.match(/\.(mp4|mov|webm)(\?.*)?$/i)
  const isCf    = p.image_url.startsWith('cloudflare-stream:')
  let uid = isCf ? p.image_url.split(':')[1] : null
  if (uid?.includes('?')) uid = uid.split('?')[0]

  const hasCaption = Boolean(p.caption || p.uploader_name || p.note)
  const showBackground = hasCaption || navVisible

  return (
    <div className={styles.container} onMouseMove={showNav} onClick={showNav} tabIndex={-1}>

      {/* ── Media ─────────────────────────────────────────────────────────── */}
      <div key={p.id} className={styles.slide}>
        {isCf ? (
          <div className={isPortrait ? styles.cfWrapPortrait : styles.cfWrapLandscape}>
            <Stream
              src={uid}
              controls={true}
              autoplay={true}
              loop={false}
              muted={false}
              className={styles.cfPlayer}
              title={p.caption || 'Video'}
              onEnded={advanceSlide}
            />
          </div>
        ) : isVid ? (
          <video
            src={p.image_url}
            className={styles.media}
            autoPlay
            playsInline
            onEnded={advanceSlide}
          />
        ) : (
          <img
            src={thumbUrl(p.image_url, 1200)}
            alt={p.caption || 'Memory'}
            loading="lazy"
            className={styles.media}
          />
        )}

        {/* ── Bottom UI (Caption + Nav seamlessly together) ────────────────── */}
      </div>

      <div className={styles.bottomUI}>
        <div className={`${styles.bottomUIBackground} ${showBackground ? styles.bgVisible : styles.bgHidden}`} />
        
        {hasCaption && (
          <div className={styles.captionArea}>
            {p.caption      && <div className={styles.caption}>{p.caption}</div>}
            {p.note         && <div className={styles.note}>{p.note}</div>}
            {p.uploader_name && <div className={styles.uploader}>— {p.uploader_name}</div>}
          </div>
        )}

        <div className={`${styles.navArea} ${navVisible ? styles.navVisible : styles.navHidden}`}>
          <button className={styles.navBtn} onClick={prevSlide} aria-label="Previous">‹</button>
          <span className={styles.counter}>{currentIndex + 1} / {photos.length}</span>
          <button className={styles.navBtn} onClick={nextSlide} aria-label="Next">›</button>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Exit slideshow">✕</button>
        </div>
      </div>

    </div>
  )
}
