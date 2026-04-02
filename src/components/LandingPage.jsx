import React, { useEffect, useState } from 'react';
import styles from './LandingPage.module.css';

export default function LandingPage({ onExit }) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Automatically transition out after 2.5 seconds
    const timer = setTimeout(() => {
      setIsExiting(true);
      // Wait for the flip animation to finish before removing from DOM
      setTimeout(() => {
        if (onExit) onExit();
      }, 1200);
    }, 2500);

    return () => clearTimeout(timer);
  }, [onExit]);

  return (
    <div className={styles.scene}>
      <div className={`${styles.landingContainer} ${isExiting ? styles.exiting : ''}`}>
        <div className={styles.imageWrapper}>
          <img src="/landing1.png" alt="Memory Wall Landing" className={styles.mainImage} />
        </div>
      </div>
    </div>
  );
}
