import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import styles from './QRDisplay.module.css'

const PAGES = [
  { label: 'Gallery', path: '/', desc: 'Browse all shared media' },
  { label: 'Upload', path: '/upload', desc: 'Share your memories' },

  { label: '♥ Donate', path: 'donate', desc: 'Help and Contribute' },


]

const DONATION_URL = import.meta.env.VITE_DONATION_URL || ''

export default function QRDisplay() {
  const [selectedPath, setSelectedPath] = useState('/')
  const [copied, setCopied] = useState(false)
  const [donationCopied, setDonationCopied] = useState(false)

  const isDonation = selectedPath === 'donate'
  const baseUrl = window.location.origin
  const fullUrl = isDonation ? DONATION_URL : `${baseUrl}${selectedPath}`

  function copyUrl() {
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function copyDonationUrl() {
    if (!DONATION_URL) return
    navigator.clipboard.writeText(DONATION_URL).then(() => {
      setDonationCopied(true)
      setTimeout(() => setDonationCopied(false), 2000)
    })
  }

  function download() {
    const svg = document.getElementById('qr-svg')
    if (!svg) return

    const canvas = document.createElement('canvas')
    const size = 512
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)

    const svgData = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size)
      const link = document.createElement('a')
      link.download = 'memory-wall-qr.png'
      link.href = canvas.toDataURL('image/png')
      link.click()
    }
    img.src = `data:image/svg+xml;base64,${btoa(svgData)}`
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>QR code</h1>
      </div>

      {/* Tab selector — now includes Donate */}
      <div className={`${styles.selector} ${styles.selectorThree}`}>
        {PAGES.map(p => (
          <button
            key={p.path}
            className={`${styles.pageBtn} ${selectedPath === p.path ? styles.pageBtnActive : ''} ${p.path === 'donate' ? styles.pageBtnDonate : ''}`}
            onClick={() => setSelectedPath(p.path)}
          >
            <span className={styles.pageBtnLabel}>{p.label}</span>
            <span className={styles.pageBtnDesc}>{p.desc}</span>
          </button>
        ))}
      </div>

      {/* QR card */}
      <div className={styles.qrCard}>
        {isDonation ? (
          /* Donation view */
          <>
            <img src="/qr.png" alt="Donation QR code" className={styles.donationQrImg} />
            <div className={styles.qrLabel}>
              <span className={styles.qrStar}>♥</span> Donations
            </div>
            <p className={styles.qrUrl}>Scan to donate — every bit helps</p>
          </>
        ) : (
          /* Gallery / Upload view */
          <>
            <div className={styles.qrWrap}>
              <QRCodeSVG
                id="qr-svg"
                value={fullUrl}
                size={220}
                bgColor="#ffffff"
                fgColor="#1a1714"
                level="M"
                includeMargin={false}
              />
            </div>
            <div className={styles.qrLabel}>
              <span className={styles.qrStar}>✦</span> Anoy's Memory Wall
            </div>
            <p className={styles.qrUrl}>{fullUrl}</p>
          </>
        )}
      </div>

      {/* Actions */}
      {isDonation ? (
        DONATION_URL && (
          <div className={styles.actions}>
            <a href={DONATION_URL} target="_blank" rel="noopener noreferrer" className={styles.primaryBtn} style={{ textAlign: 'center', textDecoration: 'none' }}>
              Open link
            </a>
            <button className={styles.ghostBtn} onClick={copyDonationUrl}>
              {donationCopied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        )
      ) : (
        <div className={styles.actions}>
          <button className={styles.primaryBtn} onClick={download}>
            Download PNG
          </button>
          <button className={styles.ghostBtn} onClick={copyUrl}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      )}

      {/* ── Tribute & Map Section ── */}<div className={styles.header}>

      </div>
      <div className={styles.mapSection}>


        <div className={styles.tributeContent}>
          <h2 className={styles.tributeTitle}>Please join us to pay a last tribute.</h2>
          <p className={styles.tributeText}>
            We invite you to join us in a solemn gathering as we come together to celebrate the life of our beloved Anoy.
          </p>
          <p className={styles.tributeText}>
            Your presence would mean a great deal to us as we remember and honor the legacy of a remarkable friend and family member. <br /><br />
            In this moment of remembrance, let us come together to share our fond memories, offer our support to one another, and bid farewell to a one of a kind individual.
          </p>
          <p className={styles.tributeText}>
            Please join us in commemorating Anoy's life and the positive impact he had on all of us.
          </p>

          <div className={styles.infoGrid}>
            <div className={styles.infoRow}>
              <div className={styles.infoIcon}>
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                <span>Location</span>
              </div>
              <div className={styles.infoDetails}>
                San Jose<br />
                Oton -San Jose - Sta Barbara Rd, San Miguel<br />
                Iloilo City, 5000 Iloilo<br />
                Philippines
              </div>
            </div>

            <div className={styles.infoRow}>
              <div className={styles.infoIcon}>
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                <span>Date/time</span>
              </div>
              <div className={styles.infoDetails}>
                Date and Time to be announced
              </div>
            </div>
          </div>
        </div>
        <div className={styles.mapContainer}>
          <iframe
            src="https://maps.google.com/maps?q=10.75996,122.4899&z=15&output=embed"
            allowFullScreen=""
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className={styles.mapIframe}
            title="Location Map"
          ></iframe>
        </div>
      </div>
    </div>
  )
}
