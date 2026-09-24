import React, { useState } from 'react';

export default function IntroScreen({ onEnter }) {
  const [leaving, setLeaving] = useState(false);

  const driveIn = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onEnter, 850);
  };

  return (
    <section className={`intro-screen ${leaving ? 'intro-screen-leaving' : ''}`}>
      <div className="intro-grid" />
      <div className="intro-copy">
        <div className="intro-kicker">TRINETRA / AUTONOMOUS VISION</div>
        <h1>Precision, in motion.</h1>
        <div className="intro-rule" />
        <p>A single intelligence tuned for the open trail.</p>
      </div>

      <div className="intro-car-track">
        <button className={`intro-car-button ${leaving ? 'intro-car-launch' : ''}`} onClick={driveIn} aria-label="Enter TRINETRA dashboard">
          <div className="intro-car">
            <svg viewBox="0 0 240 120" role="img" aria-label="TRINETRA vehicle">
              <defs>
                <linearGradient id="trinetra-paint" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#16b3a3" />
                  <stop offset="38%" stopColor="#7c5cff" />
                  <stop offset="72%" stopColor="#ff6f61" />
                  <stop offset="100%" stopColor="#f2b84b" />
                </linearGradient>
                <linearGradient id="trinetra-glass" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#40465c" />
                  <stop offset="100%" stopColor="#20222f" />
                </linearGradient>
              </defs>
              <path d="M22 82 Q18 56 46 50 L64 30 Q78 20 100 20 L146 20 Q166 20 178 32 L198 50 Q222 54 220 82 Z" fill="url(#trinetra-paint)" />
              <path d="M74 32 L96 32 L96 50 L60 50 Z" fill="url(#trinetra-glass)" />
              <path d="M104 32 L142 32 Q156 32 166 44 L172 50 L104 50 Z" fill="url(#trinetra-glass)" />
              <rect x="24" y="70" width="192" height="4" fill="#14141c" opacity=".16" />
              <circle cx="46" cy="30" r="4.5" fill="#f2b84b" />
              {[70, 172].map(cx => (
                <g key={cx} className="intro-wheel">
                  <circle cx={cx} cy="86" r="19" fill="#1a1a22" />
                  <circle cx={cx} cy="86" r="8" fill="#c8c9d2" />
                  <path d={`M${cx} 78v16M${cx - 8} 86h16M${cx - 5.7} 80.3l11.4 11.4M${cx + 5.7} 80.3l${-11.4} 11.4`} stroke="#8b8d99" strokeWidth="2" />
                </g>
              ))}
            </svg>
          </div>
        </button>
      </div>
      <p className="intro-hint">Press the vehicle to enter command center</p>
    </section>
  );
}