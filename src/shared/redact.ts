import type { ConsoleEntry, NetworkEntry } from './types';
import { sanitizeUrlForReport } from './url';

export interface FieldRedaction {
  redact: boolean;
  reason?: string;
}

const SENSITIVE_AUTOCOMPLETE = /(^|\s)(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp|cc-name)(\s|$)/i;

/**
 * Decide si un campo debe excluirse o enmascararse.
 * Se excluyen contraseñas, campos ocultos (suelen llevar CSRF/sesión) y datos de pago.
 */
export function shouldRedactField(tag: string, type: string | undefined, autocomplete: string | undefined): FieldRedaction {
  const t = (type || '').toLowerCase();
  if (t === 'password') return { redact: true, reason: 'contraseña' };
  if (t === 'hidden') return { redact: true, reason: 'campo oculto (posible token CSRF/sesión)' };
  if (autocomplete && SENSITIVE_AUTOCOMPLETE.test(autocomplete)) {
    return { redact: true, reason: `autocomplete=${autocomplete}` };
  }
  if (/(^|\s)(card|cardnumber|credit-card|iban|ssn|dni|nie)(\s|$)/i.test(t)) {
    return { redact: true, reason: `tipo sensible ${t}` };
  }
  return { redact: false };
}

export function maskValue(value: string): string {
  if (!value) return '';
  return '•'.repeat(Math.min(Math.max(value.length, 6), 24));
}

/** Atributos que nunca deben copiarse al clon. */
export function isDangerousAttribute(name: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith('on')) return true;
  if (n === 'nonce') return true;
  if (n === 'integrity') return true;
  return false;
}

/** Quita credenciales de una URL antes de registrarla. */
export function sanitizeUrl(url: string): string {
  return sanitizeUrlForReport(url);
}

export function sanitizeNetworkEntries(entries: NetworkEntry[]): NetworkEntry[] {
  return entries.map((e) => ({ ...e, url: sanitizeUrl(e.url) }));
}

export function sanitizeConsoleEntries(entries: ConsoleEntry[]): ConsoleEntry[] {
  return entries.map((e) => ({ ...e, message: redactMessages(e.message) }));
}

const SECRET_PATTERNS: RegExp[] = [
  /(bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(api[_-]?key|token|secret|password|pwd)(["'\s:=]+)([^\s"',&]{6,})/gi,
];

export function redactMessages(message: string): string {
  let out = message;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, (_m, p1?: string, p2?: string) => `${p1 ?? ''}${p2 ? p2 : ''}[REDACTED]`);
  return out;
}

/** Filtra selectores excluidos y devuelve true si el elemento debe omitirse del clon. */
export function isExcludedElement(el: Element, selectors: string[]): boolean {
  for (const selector of selectors) {
    try {
      if (el.matches(selector)) return true;
    } catch {
      /* selector inválido: se ignora */
    }
  }
  return false;
}
