import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Circle,
  FileArchive,
  Lock,
  Play,
  RotateCcw,
  Sparkles,
  Split,
  WifiOff,
} from 'lucide-react';
import { PHASES } from '../data/content';
import { useCopy } from '../hooks';

function MockPage({ cloned = false }: { cloned?: boolean }) {
  return (
    <div className="mock-page" data-cloned={cloned ? 'true' : 'false'}>
      <div className="mock-topbar">
        <span className="mock-brand"><i>A</i> Atlas<span>/</span>ops</span>
        <div className="mock-tabs">
          <span className="is-on">Resumen</span><span>Pipelines</span><span>Equipo</span>
        </div>
        <span className="mock-avatar">DR</span>
      </div>
      <div className="mock-content">
        <div className="mock-heading">
          <div>
            <p>OPERATIONS / Q4</p>
            <h4>Todo bajo control.</h4>
          </div>
          <span className="mock-status"><span /> {cloned ? 'CLONED' : 'LIVE'}</span>
        </div>
        <div className="mock-metrics">
          <div><small>Uptime</small><b>99.98%</b><em>+0.12</em></div>
          <div><small>Latencia</small><b>42ms</b><em>−8ms</em></div>
          <div><small>Eventos</small><b>18.4k</b><em>+24%</em></div>
        </div>
        <div className="mock-grid">
          <div className="mock-chart">
            <div className="mock-chart__head"><span>Actividad</span><b>últimos 30 días</b></div>
            <div className="mock-bars">
              {[28, 45, 36, 58, 44, 67, 53, 74, 62, 86, 73, 92, 84, 100, 88, 96, 80, 90, 76, 94, 86, 98, 91, 100].map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>
          <div className="mock-side">
            <span className="mock-side__title">Pipelines</span>
            {[
              ['Build', 'ok'],
              ['Deploy', 'ok'],
              ['Archive', cloned ? 'local' : 'live'],
            ].map(([label, status]) => (
              <div key={label} className="mock-row"><span>{label}</span><b className={status === 'live' ? 'is-live' : ''}>{status}</b></div>
            ))}
            <div className="mock-orbit"><span /><span /><span /></div>
          </div>
        </div>
        <div className="mock-table">
          {['webclone-prod', 'atlas-api', 'edge-worker'].map((name, index) => (
            <div key={name}><span className="mock-dot" style={{ background: ['#d8ff5f', '#60e7df', '#ff8a73'][index] }} />{name}<em>{index === 0 ? 'healthy' : 'running'}</em><b>→</b></div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CloneLab() {
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [split, setSplit] = useState(54);
  const timers = useRef<number[]>([]);
  const { copied, copy } = useCopy();

  const clearTimers = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  useEffect(() => clearTimers, []);

  const run = () => {
    clearTimers();
    setRunning(true);
    setComplete(false);
    setStep(0);
    PHASES.forEach((_, index) => {
      timers.current.push(
        window.setTimeout(() => setStep(index + 1), 620 * (index + 1)),
      );
    });
    timers.current.push(
      window.setTimeout(() => {
        setRunning(false);
        setComplete(true);
        setStep(PHASES.length);
      }, 620 * (PHASES.length + 1)),
    );
  };

  const reset = () => {
    clearTimers();
    setRunning(false);
    setComplete(false);
    setStep(-1);
    setSplit(54);
  };

  const progress = Math.max(0, Math.round((step / PHASES.length) * 100));

  return (
    <section id="laboratorio" className="section section--lab">
      <div className="shell">
        <div className="section-head" data-reveal>
          <div>
            <span className="eyebrow"><span className="live-dot" /> Laboratorio en vivo</span>
            <h2>Mira cómo se congela<br /><em>una página.</em></h2>
          </div>
          <p>
            Pulsa capturar. El laboratorio simula el pipeline real con las cifras de una captura
            verificada. Después arrastra el comparador para ver el original y el clon.
          </p>
        </div>

        <div className="lab" data-reveal>
          <div className="lab__stage">
            <div className="lab__browser">
              <div className="lab__chrome">
                <span className="browser-dots"><i /><i /><i /></span>
                <span className="lab__url"><Lock size={10} /> atlas.local/overview</span>
                <span className={`lab__mode ${complete ? 'is-clone' : ''}`}>
                  {complete ? <><WifiOff size={11} /> OFFLINE</> : <><span /> LIVE</>}
                </span>
              </div>
              <div className="lab__viewport">
                <MockPage />
                <div
                  className={`lab__clone ${complete ? 'is-visible' : ''}`}
                  style={{ clipPath: `inset(0 0 0 ${split}%)` }}
                >
                  <MockPage cloned />
                </div>
                {running && <div className="scan-line" aria-hidden="true" />}
                {!complete && (
                  <button
                    className={`capture-trigger ${running ? 'is-running' : ''}`}
                    type="button"
                    onClick={run}
                    disabled={running}
                  >
                    {running ? <><RotateCcw size={16} className="spin" /> Capturando…</> : <><Camera size={16} /> Ejecutar captura</>}
                  </button>
                )}
                {complete && (
                  <div className="lab__result">
                    <span><Check size={14} /> Captura completada</span>
                    <b>0.00% diff</b>
                  </div>
                )}
              </div>
              {complete && (
                <div className="lab__compare">
                  <span>Original</span>
                  <label>
                    <span className="sr-only">Comparar original y clon</span>
                    <input
                      type="range"
                      min="8"
                      max="92"
                      value={split}
                      onChange={(event) => setSplit(Number(event.target.value))}
                      aria-label="Comparar original y clon"
                    />
                  </label>
                  <span>Clon</span>
                  <b><Split size={13} /> arrastra</b>
                </div>
              )}
            </div>
            <div className="lab__caption">
              <span><Circle size={7} fill="currentColor" /> Motor simulado con datos reales del fixture</span>
              <span>1280 × 800 · DPR 1</span>
            </div>
          </div>

          <aside className="lab__panel" aria-live="polite">
            <div className="lab__panel-head">
              <span>Pipeline</span>
              <b className={complete ? 'is-done' : ''}>{progress}%</b>
            </div>
            <div className="lab__progress"><span style={{ width: `${progress}%` }} /></div>
            <ol className="lab__steps">
              {PHASES.map((phase, index) => {
                const state = index < step ? 'done' : index === step && running ? 'active' : 'idle';
                return (
                  <li key={phase.label} className={`is-${state}`}>
                    <span className="lab__step-icon">
                      {state === 'done' ? <Check size={13} /> : <span>{String(index + 1).padStart(2, '0')}</span>}
                    </span>
                    <div>
                      <b>{phase.label}</b>
                      <p>{phase.detail}</p>
                      <small>{phase.meta}</small>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className={`lab__report ${complete ? 'is-visible' : ''}`}>
              <div className="lab__report-head">
                <span><FileArchive size={14} /> capture-report.json</span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => copy('{\n  "elements": 4504,\n  "assetsCaptured": 36,\n  "assetsFailed": 0,\n  "visualDiff": 0,\n  "localOnly": true\n}', 'report')}
                >
                  {copied === 'report' ? <><Check size={13} /> copiado</> : 'copiar'}
                </button>
              </div>
              <pre>{`{
  "elements": 4504,
  "assetsCaptured": 36,
  "assetsFailed": 0,
  "visualDiff": 0,
  "localOnly": true
}`}</pre>
            </div>
            <div className="lab__actions">
              <button type="button" className="button button--primary button--wide" onClick={run} disabled={running}>
                {running ? <><RotateCcw size={16} className="spin" /> Procesando</> : <><Play size={16} /> {complete ? 'Repetir captura' : 'Iniciar captura'}</>}
              </button>
              <button type="button" className="button button--ghost button--wide" onClick={reset} disabled={running || step < 0}>
                <RotateCcw size={15} /> Reiniciar
              </button>
            </div>
            <p className="lab__privacy"><Sparkles size={13} /> Nada sale de tu navegador.</p>
          </aside>
        </div>
      </div>
    </section>
  );
}
