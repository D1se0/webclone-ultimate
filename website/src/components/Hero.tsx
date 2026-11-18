import { useRef } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  Lock,
  Play,
  Radio,
  Sparkles,
} from 'lucide-react';
import { REPO, STATS } from '../data/content';
import { GithubMark } from './GithubMark';

export function Hero() {
  const visual = useRef<HTMLDivElement>(null);

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = visual.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width - 0.5) * 2}`);
    element.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height - 0.5) * 2}`);
  };

  return (
    <section id="inicio" className="hero">
      <div className="hero__noise" aria-hidden="true" />
      <div className="hero__orb hero__orb--one" aria-hidden="true" />
      <div className="hero__orb hero__orb--two" aria-hidden="true" />
      <div className="hero__grid" aria-hidden="true" />

      <div className="hero__content shell">
        <div className="hero__copy">
          <div className="eyebrow hero__eyebrow" data-reveal>
            <span className="live-dot" />
            Extensión open source · Manifest V3
          </div>
          <h1 data-reveal style={{ '--delay': '70ms' } as React.CSSProperties}>
            La memoria
            <br />
            visual de <span className="hero__word">la web.</span>
          </h1>
          <p className="hero__lead" data-reveal style={{ '--delay': '150ms' } as React.CSSProperties}>
            Captura una página compleja, reconstruye su JavaScript y reproduce su red sin servidor.
            Todo en local. Todo verificable. Nada se pierde.
          </p>
          <div className="hero__cta" data-reveal style={{ '--delay': '230ms' } as React.CSSProperties}>
            <a className="button button--primary" href="#laboratorio">
              <Play size={17} aria-hidden="true" />
              Probar el laboratorio
            </a>
            <a className="button button--ghost" href={REPO} target="_blank" rel="noreferrer">
              <GithubMark size={17} />
              Ver en GitHub
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
          <div className="hero__proof" data-reveal style={{ '--delay': '310ms' } as React.CSSProperties}>
            <span><Check size={14} /> Sin cuenta</span>
            <span><Check size={14} /> Sin telemetría</span>
            <span><Lock size={14} /> Todo local</span>
          </div>
        </div>

        <div
          className="hero__visual"
          ref={visual}
          onPointerMove={move}
          data-reveal
          style={{ '--delay': '190ms' } as React.CSSProperties}
          aria-label="Visualización de una página capturada y su clon"
        >
          <div className="hero__orbit hero__orbit--outer" aria-hidden="true" />
          <div className="hero__orbit hero__orbit--inner" aria-hidden="true" />
          <div className="hero__orbit-label">CAPTURE / REPLAY</div>

          <div className="browser-window browser-window--main">
            <div className="browser-bar">
              <span className="browser-dots"><i /><i /><i /></span>
              <span className="browser-url"><Lock size={10} /> protocolexplorer.org</span>
              <span className="browser-live"><span /> LIVE</span>
            </div>
            <div className="hero-page">
              <aside className="hero-page__side">
                <span className="hero-page__logo">P</span>
                {Array.from({ length: 6 }).map((_, index) => (
                  <span key={index} className={`hero-page__nav ${index === 1 ? 'is-active' : ''}`} />
                ))}
              </aside>
              <div className="hero-page__body">
                <span className="skeleton skeleton--tag" />
                <span className="skeleton skeleton--title" />
                <span className="skeleton skeleton--title short" />
                <div className="hero-page__metrics">
                  <span /><span /><span />
                </div>
                <div className="hero-page__chart">
                  {[34, 52, 41, 67, 58, 78, 63, 88, 72, 94, 81, 104].map((height, index) => (
                    <i key={index} style={{ height }} />
                  ))}
                </div>
                <div className="hero-page__rows">
                  <span /><span /><span />
                </div>
              </div>
            </div>
          </div>

          <div className="clone-card">
            <div className="clone-card__top">
              <span className="clone-card__icon"><Camera size={16} /></span>
              <span className="clone-card__label">Instant Clone</span>
              <span className="clone-card__badge">100% local</span>
            </div>
            <div className="clone-card__body">
              <div className="clone-card__ring"><span>0.00<small>%</small></span></div>
              <div>
                <b>Paridad visual</b>
                <p>DOM + CSSOM + estado</p>
              </div>
            </div>
            <div className="clone-card__bar"><span /></div>
          </div>

          <div className="floating-chip floating-chip--network">
            <Radio size={14} /> 0 requests externas
          </div>
          <div className="floating-chip floating-chip--zip">
            <Sparkles size={14} /> ZIP · SHA-256
          </div>
          <div className="floating-chip floating-chip--offline">
            <Lock size={14} /> offline ready
          </div>
        </div>
      </div>

      <div className="hero__baseline shell">
        <div className="hero__scroll">
          <a href="#laboratorio"><ArrowDown size={15} /> Baja al laboratorio</a>
        </div>
        <div className="hero__stats">
          {STATS.map((stat) => (
            <div key={stat.label} className="stat" data-reveal>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
              <small>{stat.detail}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="ticker" aria-hidden="true">
        <div className="ticker__track">
          {Array.from({ length: 2 }).map((_, copy) => (
            <div className="ticker__set" key={copy}>
              <span>INSTANT CLONE</span><i />
              <span>FULL SESSION</span><i />
              <span>NETWORK REPLAY</span><i />
              <span>SHADOW DOM</span><i />
              <span>RRWEB</span><i />
              <span>ZERO CLOUD</span><i />
              <span>SHA-256</span><i />
              <span>OFFLINE FIRST</span><i />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HookStrip() {
  return (
    <section className="hook-strip shell" aria-label="Qué hace WebClone Ultimate">
      <div className="hook-strip__lead" data-reveal>
        <span className="eyebrow">No es un screenshot</span>
        <p>
          Es un <b>motor de serialización</b> que conserva la estructura, el estilo y el
          comportamiento observado de una página.
        </p>
      </div>
      <div className="hook-strip__items">
        <div data-reveal><span>01</span><b>DOM vivo</b><p>No HTML plano: estado real de los nodos.</p></div>
        <div data-reveal><span>02</span><b>Red grabada</b><p>fetch y XHR servidos desde el paquete.</p></div>
        <div data-reveal><span>03</span><b>Sin servidor</b><p>Un ZIP autónomo con checksums.</p></div>
      </div>
    </section>
  );
}

export function RepoBanner() {
  return (
    <div className="repo-banner shell" data-reveal>
      <div className="repo-banner__icon"><GithubMark size={28} /></div>
      <div>
        <span className="eyebrow">Open source · MIT</span>
        <p>El motor completo, los tests y esta web están en el repositorio.</p>
      </div>
      <a className="button button--dark" href={REPO} target="_blank" rel="noreferrer">
        Explorar el código <ArrowRight size={16} />
      </a>
    </div>
  );
}
