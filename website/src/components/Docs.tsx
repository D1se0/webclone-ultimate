import { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Lock,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  COMPATIBILITY,
  DOC_ARTICLES,
  FAQ,
  REPO,
} from '../data/content';
import { useCopy } from '../hooks';
import { GithubMark } from './GithubMark';
import { SectionHead } from './Sections';

export function Docs() {
  const { copied, copy } = useCopy();
  return (
    <section id="docs" className="section section--docs">
      <div className="shell">
        <SectionHead
          eyebrow="Manual de campo"
          title={<>Todo lo que necesitas<br />para <em>usarlo bien.</em></>}
          description="Instalación, captura, sesiones, privacidad, límites y diagnóstico. Sin promesas que el motor no pueda cumplir."
        />
        <div className="docs">
          <aside className="docs__aside" data-reveal>
            <span className="eyebrow">En esta guía</span>
            <nav aria-label="Secciones de documentación">
              {DOC_ARTICLES.map((article, index) => (
                <a key={article.id} href={`#doc-${article.id}`}>
                  <span>0{index + 1}</span>{article.title}
                </a>
              ))}
            </nav>
            <div className="docs__repo-card">
              <GithubMark size={20} />
              <b>Documentación completa</b>
              <p>Arquitectura, limitaciones, pruebas y guía de publicación en el repositorio.</p>
              <a href={`${REPO}#documentación`} target="_blank" rel="noreferrer">
                Abrir docs <ArrowUpRight size={13} />
              </a>
            </div>
          </aside>
          <div className="docs__articles">
            {DOC_ARTICLES.map((article, index) => (
              <article key={article.id} id={`doc-${article.id}`} className="doc-article" data-reveal>
                <div className="doc-article__num">{String(index + 1).padStart(2, '0')}</div>
                <div className="doc-article__body">
                  <span className="eyebrow">{article.kicker}</span>
                  <h3>{article.title}</h3>
                  {article.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {article.points && (
                    <ul className="check-list check-list--small">
                      {article.points.map((point) => <li key={point}><Check size={14} /> {point}</li>)}
                    </ul>
                  )}
                  {article.code && (
                    <div className="doc-code">
                      <div className="doc-code__bar">
                        <span><FileText size={13} /> {article.code.label}</span>
                        <button type="button" onClick={() => copy(article.code!.value, article.id)} aria-label={`Copiar ${article.title}`}>
                          {copied === article.id ? <><Check size={13} /> copiado</> : <><Copy size={13} /> copiar</>}
                        </button>
                      </div>
                      <pre><code>{article.code.value}</code></pre>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Trust() {
  return (
    <section className="trust">
      <div className="shell trust__grid">
        <div className="trust__copy" data-reveal>
          <span className="eyebrow"><Lock size={13} /> Privacidad, no marketing</span>
          <h2>Tu navegador es<br /><em>el único servidor.</em></h2>
          <p>
            No hay cuenta, no hay nube y no hay telemetría. La extensión descarga recursos con los
            permisos que tú concedes y empaqueta todo en memoria. El ZIP se queda en tu equipo.
          </p>
          <a className="text-link" href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">
            Leer el modelo de seguridad <ArrowUpRight size={14} />
          </a>
        </div>
        <div className="trust__visual" data-reveal aria-label="Flujo local de datos">
          <div className="trust-orbit">
            <div className="trust-core"><ShieldCheck size={28} /><span>LOCAL</span></div>
            <span className="trust-node trust-node--1"><span /> DOM</span>
            <span className="trust-node trust-node--2"><span /> CSS</span>
            <span className="trust-node trust-node--3"><span /> NET</span>
            <span className="trust-node trust-node--4"><span /> ZIP</span>
            <div className="trust-ring trust-ring--1" />
            <div className="trust-ring trust-ring--2" />
          </div>
          <div className="trust__badges">
            <span><Check size={13} /> Sin cuenta</span>
            <span><Check size={13} /> Sin cookies</span>
            <span><Check size={13} /> Sin telemetría</span>
          </div>
        </div>
      </div>
      <div className="trust__marquee" aria-hidden="true">
        <span>LOCAL ONLY · ZERO CLOUD · SHA-256 · OFFLINE READY · LOCAL ONLY · ZERO CLOUD · SHA-256 · OFFLINE READY</span>
      </div>
    </section>
  );
}

export function Compatibility() {
  return (
    <section id="compatibilidad" className="section section--compat">
      <div className="shell">
        <SectionHead
          eyebrow="Compatibilidad honesta"
          title={<>Funciona donde<br /><em>tiene que funcionar.</em></>}
          description="Chrome, Chromium, Edge y Firefox. La misma base MV3 con las diferencias de background y hooks documentadas. Las limitaciones también están aquí."
        />
        <div className="compat" data-reveal>
          <div className="compat__head">
            <span>Capacidad</span><span>Chrome / Chromium</span><span>Firefox</span><span>Nota</span>
          </div>
          {COMPATIBILITY.map((row) => (
            <div className="compat__row" key={row.feature}>
              <span className="compat__feature">{row.feature}</span>
              <span className="compat__value"><Check size={14} /> {row.chrome}</span>
              <span className="compat__value"><Check size={14} /> {row.firefox}</span>
              <span className="compat__note">{row.note}</span>
            </div>
          ))}
        </div>
        <div className="compat__limits" data-reveal>
          <div><X size={17} /><b>No capturable</b><p>Páginas internas, PDFs nativos, Chrome Web Store e iframes cross-origin.</p></div>
          <div><Lock size={17} /><b>No se elude</b><p>DRM, same-origin policy, WebSocket/SSE en vivo ni lógica de backend.</p></div>
          <div><Sparkles size={17} /><b>Sí se conserva</b><p>DOM, CSS, estado, recursos, red observada, ruta y storage no sensible.</p></div>
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="section section--faq">
      <div className="shell faq">
        <div className="faq__intro" data-reveal>
          <span className="eyebrow">Preguntas frecuentes</span>
          <h2>Lo que suele<br /><em>preguntarse.</em></h2>
          <p>Si tu duda no está aquí, abre un issue con contexto reproducible. No hay preguntas tontas, solo capturas incompletas.</p>
          <a className="button button--ghost" href={`${REPO}/issues/new/choose`} target="_blank" rel="noreferrer">
            Abrir un issue <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="faq__list" data-reveal>
          {FAQ.map((item, index) => {
            const isOpen = open === index;
            return (
              <div key={item.question} className={`faq__item ${isOpen ? 'is-open' : ''}`}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${index}`}
                  onClick={() => setOpen(isOpen ? null : index)}
                >
                  <span>0{index + 1}</span>
                  <b>{item.question}</b>
                  <ChevronDown size={18} className="faq__chevron" />
                </button>
                <div id={`faq-answer-${index}`} className="faq__answer" hidden={!isOpen}>
                  <p>{item.answer}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
