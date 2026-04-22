import { useState, useEffect, lazy, Suspense } from 'react'
import Gallery from './components/Gallery'
import LandingPage from './components/LandingPage'
import { supabase } from './lib/supabase'
import styles from './App.module.css'

// Code-split heavy components — UploadForm bundles FFmpeg, Slideshow is large
const UploadForm = lazy(() => import('./components/UploadForm'))
const QRDisplay  = lazy(() => import('./components/QRDisplay'))
const Slideshow  = lazy(() => import('./components/Slideshow'))

const ROUTES = {
  '/': 'gallery',
  '/upload': 'upload',
  '/qr': 'qr',
  '/slideshow': 'slideshow',
}

function getPage() {
  return ROUTES[window.location.pathname] || 'gallery'
}

export default function App() {
  const [showLanding, setShowLanding] = useState(true)
  const [page, setPage] = useState(getPage)
  const [isAdmin, setIsAdmin] = useState(false)
  const [showAdminPrompt, setShowAdminPrompt] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')

  useEffect(() => {
    const handlePop = () => setPage(getPage())
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  function navigate(path) {
    window.history.pushState({}, '', path)
    setPage(ROUTES[path] || 'gallery')
  }

  function handleFooterClick() {
    if (!isAdmin) {
      setShowAdminPrompt(true)
    } else {
      setIsAdmin(false)
    }
  }

  async function handleAdminSubmit(e) {
    e.preventDefault()
    try {
      const { data, error } = await supabase.functions.invoke('admin-verify', {
        body: { password: adminPassword },
      })
      if (!error && data?.ok) {
        setIsAdmin(true)
        setShowAdminPrompt(false)
      }
    } catch {
      // Edge Function unreachable — silent fail
    }
    setAdminPassword('')
  }

  if (page === 'slideshow') {
    return (
      <Suspense fallback={<div style={{ color: '#fff', padding: '2rem' }}>Loading…</div>}>
        <Slideshow onClose={() => navigate('/')} />
      </Suspense>
    )
  }

  return (
    <>
      {showLanding && <LandingPage onExit={() => setShowLanding(false)} />}
      <div className={styles.app}>
        <header className={styles.header}>
          <button className={styles.logo} onClick={() => navigate('/')}>
            <img src="/icon.jpg" alt="logo" className={styles.logoHeart} />
            Anoy's Memories
          </button>
          <nav className={styles.nav}>
            <button
              className={`${styles.navLink} ${page === 'gallery' ? styles.active : ''}`}
              onClick={() => navigate('/')}
            >
              Gallery
            </button>
            <button
              className={`${styles.navLink} ${page === 'upload' ? styles.active : ''}`}
              onClick={() => navigate('/upload')}
            >
              Add Media
            </button>
            <button
              className={`${styles.navLink} ${page === 'qr' ? styles.active : ''}`}
              onClick={() => navigate('/qr')}
            >
              QR code
            </button>
            <button
              className={`${styles.navLink} ${page === 'slideshow' ? styles.active : ''}`}
              onClick={() => navigate('/slideshow')}
            >
              Slideshow
            </button>
          </nav>
        </header>

        <main className={styles.main}>
          {/*
            Gallery is always-mounted so its fetched data and realtime
            subscription survive tab switches. Only CSS visibility toggles.
          */}
          <div style={{ display: page === 'gallery' ? '' : 'none' }}>
            <Gallery onUpload={() => navigate('/upload')} isAdmin={isAdmin} />
          </div>

          <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>}>
            {page === 'upload' && <UploadForm onSuccess={() => navigate('/')} />}
            {page === 'qr'     && <QRDisplay />}
          </Suspense>
        </main>

        <footer className={styles.footer}>
          <span onClick={handleFooterClick} style={{ cursor: 'pointer' }}>
            From all those who loved and cherished his company ♥ {isAdmin && '(Admin)'}
          </span>
        </footer>

        {showAdminPrompt && (
          <div className={styles.adminOverlay} onClick={() => setShowAdminPrompt(false)}>
            <div className={styles.adminModal} onClick={e => e.stopPropagation()}>
              <h3 className={styles.adminTitle}>Enter Admin Password</h3>
              <form onSubmit={handleAdminSubmit}>
                <input
                  type="password"
                  className={styles.adminInput}
                  value={adminPassword}
                  onChange={e => setAdminPassword(e.target.value)}
                  placeholder="Password"
                  autoFocus
                />
                <div className={styles.adminBtns}>
                  <button type="button" className={styles.adminCancel} onClick={() => setShowAdminPrompt(false)}>Cancel</button>
                  <button type="submit" className={styles.adminSubmit}>Login</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
