import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('WebClone Ultimate website', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.dataset.theme = 'dark';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renderiza la portada, el laboratorio y la documentación', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /la memoria/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /mira cómo se congela/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /todo lo que necesitas/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver en github/i })).toHaveAttribute(
      'href',
      'https://github.com/D1se0/webclone-ultimate',
    );
    expect(screen.getAllByText(/sin telemetría/i).length).toBeGreaterThan(0);
  });

  it('cambia entre los cuatro modos de captura', () => {
    render(<App />);
    const dynamicTab = screen.getByRole('tab', { name: /JS local y respuestas grabadas/i });
    fireEvent.click(dynamicTab);
    expect(dynamicTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: /javascript sigue vivo/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Ruta, storage y POST offline/i }));
    expect(screen.getByRole('heading', { name: /una sesión completa/i })).toBeInTheDocument();
  });

  it('completa una captura simulada y muestra el informe', () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /ejecutar captura/i }));
    act(() => {
      vi.advanceTimersByTime(3_300);
    });
    expect(screen.getByText(/captura completada/i)).toBeInTheDocument();
    expect(screen.getByText('0.00% diff')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /comparar original y clon/i })).toBeInTheDocument();
  });

  it('alterna el tema y lo guarda', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /activar tema claro/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('wc-theme')).toBe('light');
    expect(screen.getByRole('button', { name: /activar tema oscuro/i })).toBeInTheDocument();
  });

  it('abre una entrada del ZIP y un ejemplo de terminal', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /network\/responses.json/i }));
    expect(screen.getByRole('heading', { name: 'network/responses.json' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Empaquetar' }));
    expect(screen.getByRole('heading', { name: /artefactos listos/i })).toBeInTheDocument();
    expect(screen.getByText(/webclone-ultimate-chrome-1.2.0.zip/)).toBeInTheDocument();
  });

  it('despliega las respuestas del FAQ', () => {
    render(<App />);
    const question = screen.getByRole('button', { name: /esto sube mis páginas/i });
    expect(question).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(question);
    expect(question).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(question);
    expect(question).toHaveAttribute('aria-expanded', 'true');
  });
});
