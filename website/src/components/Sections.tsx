import { useState } from 'react';
import {
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  CirclePlay,
  Code,
  Copy,
  Database,
  FileArchive,
  FileJson,
  Folder,
  Globe,
  Layers,
  Network,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Video,
  Zap,
} from 'lucide-react';
import {
  CAPABILITIES,
  EXAMPLES,
  PIPELINE,
  ZIP_NODES,
  type Capability,
} from '../data/content';
import { useCopy } from '../hooks';

const CAP_ICONS = {
  instant: Camera,
  dynamic: Zap,
  full: Layers,
  record: Video,
} satisfies Record<Capability['id'], typeof Camera>;

export function SectionHead({
  eyebrow,
  title,
  description,
  align = 'split',
}: {
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  align?: 'split' | 'center';
}) {
  return (
    <div className={`section-head section-head--${align}`} data-reveal>
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <p>{description}</p>
    </div>
  );
}

export function Capabilities() {
  const [activeId, setActiveId] = useState<Capability['id']>('instant');
  const active = CAPABILITIES.find((item) => item.id === activeId) ?? CAPABILITIES[0]!;
  const { copied, copy } = useCopy();
  const Icon = CAP_ICONS[active.id];

  return (
    <section id="capacidades" className="section section--capabilities">
      <div className="shell">
        <SectionHead
          eyebrow="Cuatro formas de recordar"
          title={<>Una herramienta.<br /><em>Cuatro memorias.</em></>}
          description="Desde una instantánea visual hasta una sesión que conserva la red, la ruta y el storage. Elige la memoria que necesitas; el motor es el mismo."
        />

        <div className={`capabilities accent-${active.accent}`}>
          <div className="capabilities__tabs" role="tablist" aria-label="Modos de captura">
            {CAPABILITIES.map((capability) => {
              const TabIcon = CAP_ICONS[capability.id];
              return (
                <button
                  key={capability.id}
                  type="button"
                  role="tab"
                  id={`tab-${capability.id}`}
                  aria-selected={activeId === capability.id}
                  aria-controls={`panel-${capability.id}`}
                  className={`cap-tab ${activeId === capability.id ? 'is-active' : ''}`}
                  onClick={() => setActiveId(capability.id)}
                >
                  <span className="cap-tab__icon"><TabIcon size={18} /></span>
                  <span>
                    <b>{capability.short}</b>
                    <small>{capability.eyebrow.split(' · ')[0]}</small>
                  </span>
                  <ChevronRight size={16} className="cap-tab__arrow" />
                </button>
              );
            })}
          </div>

          <div
            className="capabilities__panel"
            role="tabpanel"
            id={`panel-${active.id}`}
            aria-labelledby={`tab-${active.id}`}
            key={active.id}
          >
            <div className="cap-panel__copy">
              <span className="eyebrow">{active.eyebrow}</span>
              <h3>{active.title}</h3>
              <p>{active.description}</p>
              <ul className="check-list">
                {active.bullets.map((bullet) => (
                  <li key={bullet}><Check size={15} /> {bullet}</li>
                ))}
              </ul>
              <div className="cap-stat">
                <strong>{active.stat}</strong>
                <span>{active.statLabel}</span>
              </div>
            </div>
            <div className="cap-panel__visual">
              <div className="cap-panel__visual-top">
                <span><Icon size={16} /> {active.eyebrow.split(' · ')[1]}</span>
                <span className="dot-status"><i /> activo</span>
              </div>
              <div className="cap-panel__mock" aria-hidden="true">
                {active.id === 'instant' && (
                  <>
                    <div className="mock-clone-badge"><Camera size={14} /> snapshot</div>
                    <div className="wire-page">
                      <span className="wire-page__bar" />
                      <div><span /><span /><span /></div>
                      <span className="wire-page__block" />
                      <span className="wire-page__block short" />
                    </div>
                    <div className="mock-pill pill-a">DOM</div>
                    <div className="mock-pill pill-b">CSSOM</div>
                    <div className="mock-pill pill-c">state</div>
                  </>
                )}
                {active.id === 'dynamic' && (
                  <>
                    <div className="network-map">
                      <span className="network-node network-node--main"><Globe size={20} /></span>
                      {[0, 1, 2, 3].map((index) => (
                        <span key={index} className={`network-node network-node--${index}`}><Database size={13} /></span>
                      ))}
                      <svg viewBox="0 0 300 200" aria-hidden="true">
                        <path d="M150 100 C90 60 70 30 45 25" />
                        <path d="M150 100 C210 55 240 40 262 62" />
                        <path d="M150 100 C85 150 65 175 38 178" />
                        <path d="M150 100 C200 145 236 160 264 172" />
                      </svg>
                    </div>
                    <div className="mock-code-float">200 · cached</div>
                  </>
                )}
                {active.id === 'full' && (
                  <>
                    <div className="session-steps">
                      <div className="session-step is-done"><Check size={13} /><span>POST /api/session-add</span><b>200</b></div>
                      <div className="session-step is-done"><Check size={13} /><span>POST /api/session-add</span><b>200</b></div>
                      <div className="session-step is-done"><Check size={13} /><span>navigate ?step=2</span><b>200</b></div>
                      <div className="session-step"><RefreshCw size={13} /><span>offline replay</span><b>local</b></div>
                    </div>
                    <div className="mock-pill pill-a">route</div>
                    <div className="mock-pill pill-b">storage</div>
                  </>
                )}
                {active.id === 'record' && (
                  <>
                    <div className="record-timeline">
                      <div className="record-head"><span><i /> REC</span><b>00:12.84</b></div>
                      <div className="record-track">
                        {[12, 22, 17, 38, 28, 52, 42, 68, 47, 78, 58, 86, 64, 91, 74, 82, 63, 88].map((height, index) => (
                          <span key={index} style={{ height: `${height}%` }} />
                        ))}
                        <i className="record-cursor" />
                      </div>
                      <div className="record-marks">
                        <span>00:02 snapshot</span><span>00:07 nav</span><span>00:11 click</span>
                      </div>
                    </div>
                    <div className="mock-pill pill-a">rrweb</div>
                    <div className="mock-pill pill-b">11 events</div>
                  </>
                )}
              </div>
              <div className="code-block code-block--small">
                <div className="code-block__bar"><span>{active.id === 'full' ? 'reconstrucción' : 'consola'}</span><span className="mono">webclone</span></div>
                <pre><code>{active.snippet}</code></pre>
                <button type="button" className="code-copy" onClick={() => copy(active.snippet, active.id)} aria-label="Copiar ejemplo">
                  {copied === active.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Pipeline() {
  const [active, setActive] = useState(0);
  const step = PIPELINE[active]!;
  return (
    <section id="pipeline" className="section section--pipeline">
      <div className="shell">
        <SectionHead
          eyebrow="El motor por dentro"
          title={<>De la pestaña<br />al <em>ZIP.</em></>}
          description="Cuatro fases deterministas. Puedes inspeccionar qué entra y qué sale en cada una. El informe conserva los fallos y las alternativas, sin convertirlos en éxitos."
        />
        <div className="pipeline" data-reveal>
          <div className="pipeline__rail" role="tablist" aria-label="Fases del motor">
            {PIPELINE.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active === index}
                aria-controls={`pipeline-panel-${item.id}`}
                className={`pipeline__step ${active === index ? 'is-active' : ''} ${index < active ? 'is-past' : ''}`}
                onClick={() => setActive(index)}
              >
                <span className="pipeline__number">{item.number}</span>
                <span className="pipeline__dot">{index < active ? <Check size={13} /> : null}</span>
                <span>
                  <b>{item.title}</b>
                  <small>{item.summary}</small>
                </span>
              </button>
            ))}
          </div>
          <div
            className="pipeline__panel"
            role="tabpanel"
            id={`pipeline-panel-${step.id}`}
            aria-label={step.title}
            key={step.id}
          >
            <div className="pipeline__copy">
              <span className="eyebrow">Fase {step.number} / 04</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
              <div className="pipeline__tags">
                <span><ShieldCheck size={13} /> determinista</span>
                <span><FileArchive size={13} /> verificable</span>
                <span><Radio size={13} /> offline</span>
              </div>
            </div>
            <div className="pipeline__terminal">
              <div className="terminal-bar">
                <span><i /><i /><i /></span>
                <span>webclone · {step.id}</span>
                <span className="terminal-live"><i /> local</span>
              </div>
              <pre><code>{step.output}</code></pre>
              <div className="terminal-foot"><span>© WebClone Ultimate</span><span>sin red externa</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Examples() {
  const [activeId, setActiveId] = useState(EXAMPLES[0]!.id);
  const active = EXAMPLES.find((example) => example.id === activeId) ?? EXAMPLES[0]!;
  const { copied, copy } = useCopy();

  return (
    <section id="ejemplos" className="section section--examples">
      <div className="shell">
        <SectionHead
          eyebrow="Ejemplos reales"
          title={<>Menos teoría.<br /><em>Más terminal.</em></>}
          description="Comandos que existen en el repositorio y contratos que usan los tests. Copia, ejecuta y comprueba el resultado."
        />
        <div className="examples" data-reveal>
          <div className="examples__tabs" role="tablist" aria-label="Ejemplos">
            {EXAMPLES.map((example) => (
              <button
                key={example.id}
                type="button"
                role="tab"
                aria-selected={activeId === example.id}
                aria-controls={`example-${example.id}`}
                className={activeId === example.id ? 'is-active' : ''}
                onClick={() => setActiveId(example.id)}
              >
                {example.label}
              </button>
            ))}
          </div>
          <div className="examples__body" role="tabpanel" id={`example-${active.id}`}>
            <div className="examples__intro">
              <span className="examples__lang">{active.language}</span>
              <h3>{active.title}</h3>
              <p>{active.description}</p>
              <a className="text-link" href="#docs">Leer la documentación <ArrowRight size={14} /></a>
            </div>
            <div className="code-block code-block--large">
              <div className="code-block__bar">
                <span><Terminal size={14} /> {active.id}.{active.language === 'bash' ? 'sh' : active.language}</span>
                <button type="button" onClick={() => copy(active.code, active.id)} className="copy-button">
                  {copied === active.id ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}
                </button>
              </div>
              <pre><code>{active.code}</code></pre>
            </div>
          </div>
        </div>
        <div className="example-notes">
          <article data-reveal><Code size={18} /><h4>Contratos estables</h4><p>Los mensajes del popup están cubiertos por tests E2E.</p></article>
          <article data-reveal><FileJson size={18} /><h4>Salida inspeccionable</h4><p>Cada ZIP incluye metadata, informe y checksums.</p></article>
          <article data-reveal><ShieldCheck size={18} /><h4>Verificación externa</h4><p>Python y unzip validan el paquete, no solo el código JS.</p></article>
        </div>
      </div>
    </section>
  );
}

const KIND_ICON = {
  folder: Folder,
  html: Globe,
  json: FileJson,
  js: Code,
  asset: FileArchive,
} satisfies Record<(typeof ZIP_NODES)[number]['kind'], typeof Folder>;

export function ZipAnatomy() {
  const [activeId, setActiveId] = useState(ZIP_NODES[0]!.id);
  const active = ZIP_NODES.find((node) => node.id === activeId) ?? ZIP_NODES[0]!;
  const { copied, copy } = useCopy();

  return (
    <section id="formato" className="section section--zip">
      <div className="shell">
        <SectionHead
          eyebrow="Anatomía de un paquete"
          title={<>Un ZIP que se<br /><em>explica solo.</em></>}
          description="No es una caja negra. Cada archivo tiene una responsabilidad, un checksum y una guía. Haz clic en el árbol para inspeccionar el contenido."
        />
        <div className="zip" data-reveal>
          <div className="zip__tree">
            <div className="zip__tree-head">
              <span><Folder size={15} /> webclone-export</span>
              <b>17 files</b>
            </div>
            <div className="zip__tree-body">
              <div className="zip__folder"><ChevronRight size={13} /> snapshot/</div>
              <div className="zip__folder"><ChevronRight size={13} /> assets/</div>
              <div className="zip__folder"><ChevronRight size={13} /> reports/</div>
              {ZIP_NODES.map((node) => {
                const Icon = KIND_ICON[node.kind];
                const isNested = node.path.includes('/');
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={`zip__node ${isNested ? 'is-nested' : ''} ${active.id === node.id ? 'is-active' : ''}`}
                    onClick={() => setActiveId(node.id)}
                  >
                    <Icon size={14} />
                    <span>{node.path}</span>
                    {node.id === 'metadata' && <em>sha</em>}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="zip__copy"
              onClick={() => copy(active.content, active.id)}
            >
              {copied === active.id ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar archivo</>}
            </button>
          </div>
          <div className="zip__viewer" key={active.id}>
            <div className="zip__viewer-head">
              <div>
                <span className="eyebrow">{active.kind.toUpperCase()}</span>
                <h3>{active.path}</h3>
              </div>
              <span className="zip__verified"><ShieldCheck size={14} /> SHA-256</span>
            </div>
            <p>{active.description}</p>
            <pre><code>{active.content}</code></pre>
            <div className="zip__viewer-foot">
              <span><Sparkles size={13} /> {active.label}</span>
              <span>UTF-8 · LF</span>
            </div>
          </div>
        </div>
        <div className="zip-privacy" data-reveal>
          <ShieldCheck size={20} />
          <p><b>Privacidad por diseño.</b> El paquete no guarda cookies, Authorization ni contraseñas. Aun así, el HTML y las respuestas pueden contener datos visibles de la cuenta: revísalo antes de compartirlo.</p>
        </div>
      </div>
    </section>
  );
}

export function CtaBand() {
  return (
    <section className="cta-band">
      <div className="cta-band__grain" aria-hidden="true" />
      <div className="shell cta-band__inner" data-reveal>
        <span className="eyebrow">El siguiente instante es tuyo</span>
        <h2>No dejes que la web<br /><em>se olvide de sí misma.</em></h2>
        <div className="cta-band__actions">
          <a className="button button--primary" href="#laboratorio"><CirclePlay size={17} /> Volver al laboratorio</a>
          <a className="button button--ghost" href="https://github.com/D1se0/webclone-ultimate" target="_blank" rel="noreferrer"><Play size={17} /> Instalar desde GitHub</a>
        </div>
        <div className="cta-band__meta">
          <span><Check size={14} /> MIT License</span>
          <span><Check size={14} /> Sin cuenta</span>
          <span><Check size={14} /> 100% local</span>
        </div>
      </div>
    </section>
  );
}
