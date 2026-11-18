import { describe, expect, it } from 'vitest';
import { isDangerousAttribute, maskValue, redactMessages, sanitizeNetworkEntries, shouldRedactField } from '../../src/shared/redact';

describe('redact', () => {
  it('excluye contraseñas, ocultos y datos de pago', () => {
    expect(shouldRedactField('input', 'password', undefined)).toEqual({ redact: true, reason: 'contraseña' });
    expect(shouldRedactField('input', 'hidden', undefined).redact).toBe(true);
    expect(shouldRedactField('input', 'text', 'cc-number').redact).toBe(true);
    expect(shouldRedactField('input', 'text', 'one-time-code').redact).toBe(true);
    expect(shouldRedactField('input', 'text', 'email').redact).toBe(false);
    expect(shouldRedactField('textarea', undefined, undefined).redact).toBe(false);
  });

  it('enmascara valores', () => {
    expect(maskValue('secreto')).toBe('•••••••');
    expect(maskValue('')).toBe('');
    expect(maskValue('x'.repeat(100)).length).toBe(24);
  });

  it('elimina atributos peligrosos', () => {
    expect(isDangerousAttribute('onclick')).toBe(true);
    expect(isDangerousAttribute('ONLOAD')).toBe(true);
    expect(isDangerousAttribute('nonce')).toBe(true);
    expect(isDangerousAttribute('integrity')).toBe(true);
    expect(isDangerousAttribute('class')).toBe(false);
  });

  it('redacta secretos en mensajes', () => {
    expect(redactMessages('Authorization: Bearer abcdefghijklmnopq')).not.toContain('abcdefghijklmnopq');
    expect(redactMessages('api_key=supersecretvalue')).not.toContain('supersecretvalue');
    expect(redactMessages('Error normal sin secretos')).toBe('Error normal sin secretos');
  });

  it('sanea URLs de red', () => {
    const entries = sanitizeNetworkEntries([
      { t: 1, url: 'https://x.test/a?token=abc&id=2', method: 'GET', status: 200, resourceType: 'fetch', durationMs: 5, transferSize: 10, failed: false, sameOrigin: true },
    ]);
    expect(entries[0].url).not.toContain('abc');
    expect(entries[0].url).toContain('id=2');
  });
});
