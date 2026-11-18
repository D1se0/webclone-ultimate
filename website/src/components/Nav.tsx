import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Menu,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import { NAV_ITEMS, REPO } from '../data/content';
import { GithubMark } from './GithubMark';
import { useScrolled, useScrollProgress, useScrollSpy, type Theme } from '../hooks';

export function ScrollProgress() {
  const progress = useScrollProgress();
  return (
    <div className="scroll-progress" aria-hidden="true">
      <span style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" role="presentation">
          <path d="M5 8.5 10 25l6-8.5 6 8.5 5-16.5" />
          <path className="brand__mark-accent" d="M5 8.5 16 4l11 4.5" />
        </svg>
      </span>
      <span className="brand__text">
        WebClone <b>Ultimate</b>
      </span>
    </span>
  );
}

export function Nav({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const scrolled = useScrolled();
  const active = useScrollSpy(NAV_ITEMS.map((item) => item.id));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('menu-open', open);
    return () => document.body.classList.remove('menu-open');
  }, [open]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  return (
    <>
      <ScrollProgress />
      <header className={`nav ${scrolled ? 'nav--scrolled' : ''}`}>
        <a className="nav__brand" href="#inicio" aria-label="WebClone Ultimate, inicio">
          <Logo />
        </a>
        <nav className="nav__links" aria-label="Navegación principal">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={active === item.id ? 'is-active' : undefined}
              aria-current={active === item.id ? 'true' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="nav__actions">
          <a className="nav__github" href={REPO} target="_blank" rel="noreferrer">
            <GithubMark size={17} />
            <span>GitHub</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <button
            type="button"
            className="icon-button theme-toggle"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Activar tema claro' : 'Activar tema oscuro'}
            title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            type="button"
            className="icon-button nav__burger"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            aria-controls="mobile-menu"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>
      <div id="mobile-menu" className={`mobile-menu ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <div className="mobile-menu__inner">
          <p className="eyebrow">Mapa del laboratorio</p>
          {NAV_ITEMS.map((item, index) => (
            <a key={item.id} href={`#${item.id}`} onClick={() => setOpen(false)}>
              <span>0{index + 1}</span>
              {item.label}
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          ))}
          <a className="mobile-menu__repo" href={REPO} target="_blank" rel="noreferrer">
            <GithubMark size={18} /> Ver el repositorio
          </a>
          <button type="button" className="mobile-menu__theme" onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
          </button>
        </div>
      </div>
    </>
  );
}

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="footer__top">
        <div>
          <Logo />
          <p className="footer__claim">
            La memoria visual de la web.
            <br />
            Captura, reconstruye y conserva.
          </p>
        </div>
        <div className="footer__links">
          <div>
            <p className="footer__label">Proyecto</p>
            <a href={REPO} target="_blank" rel="noreferrer">
              Repositorio <ArrowUpRight size={13} />
            </a>
            <a href="#docs">Documentación</a>
            <a href="#compatibilidad">Compatibilidad</a>
          </div>
          <div>
            <p className="footer__label">Técnico</p>
            <a href={`${REPO}/blob/main/ARCHITECTURE.md`} target="_blank" rel="noreferrer">
              Arquitectura
            </a>
            <a href={`${REPO}/blob/main/LIMITATIONS.md`} target="_blank" rel="noreferrer">
              Limitaciones
            </a>
            <a href={`${REPO}/blob/main/docs/TESTING.md`} target="_blank" rel="noreferrer">
              Pruebas
            </a>
          </div>
          <div>
            <p className="footer__label">Legal</p>
            <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
              MIT License
            </a>
            <a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">
              Seguridad
            </a>
            <a href={`${REPO}/blob/main/CODE_OF_CONDUCT.md`} target="_blank" rel="noreferrer">
              Conducta
            </a>
          </div>
        </div>
      </div>
      <div className="footer__bottom">
        <span>© {year} D1se0 · Hecho para la web que no quieres perder.</span>
        <span className="footer__status">
          <Check size={13} aria-hidden="true" /> Todo ocurre en tu navegador
        </span>
      </div>
    </footer>
  );
}

export function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > 900);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return (
    <a
      href="#inicio"
      className={`to-top ${visible ? 'is-visible' : ''}`}
      aria-label="Volver al inicio"
      tabIndex={visible ? 0 : -1}
    >
      ↑
    </a>
  );
}
