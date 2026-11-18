/**
 * Captura del estado observable del documento vivo para el clon dinámico.
 * A diferencia del serializador estático, no asigna data-wc-id: usa selectores
 * CSS, de modo que el estado se puede aplicar sobre el HTML original.
 */

import type {
  CanvasState,
  FormFieldState,
  MediaState,
  OpenState,
  PageState,
  ScrollState,
} from '../shared/types';
import { buildSelector } from '../shared/selector';
import { maskValue, shouldRedactField } from '../shared/redact';
import { sanitizeUrlForReport, absolutize } from '../shared/url';

const MAX_ELEMENTS = 20_000;

export function captureLiveState(doc: Document, options: { dynamic?: boolean } = {}): PageState {
  const win = doc.defaultView;
  const state: PageState = {
    version: 1,
    url: doc.URL,
    title: doc.title,
    capturedAt: new Date().toISOString(),
    viewport: {
      width: win?.innerWidth ?? 0,
      height: win?.innerHeight ?? 0,
      scrollX: Math.round(win?.scrollX ?? 0),
      scrollY: Math.round(win?.scrollY ?? 0),
      devicePixelRatio: win?.devicePixelRatio || 1,
    },
    forms: [],
    scrollables: [],
    media: [],
    canvases: [],
    details: [],
    dialogs: [],
    popovers: [],
    missing: [],
    dynamic: !!options.dynamic,
  };

  const forms: FormFieldState[] = [];
  const scrollables: ScrollState[] = [];
  const media: MediaState[] = [];
  const canvases: CanvasState[] = [];
  const details: OpenState[] = [];
  const dialogs: OpenState[] = [];
  const popovers: OpenState[] = [];
  const base = doc.baseURI;
  const elements = doc.querySelectorAll('*');
  const limit = Math.min(elements.length, MAX_ELEMENTS);

  for (let i = 0; i < limit; i++) {
    const el = elements[i];
    const tag = el.tagName.toLowerCase();
    const selector = buildSelector(el);

    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const record = captureForm(el as HTMLInputElement, tag, selector);
      if (record) forms.push(record);
    }
    if (tag === 'video' || tag === 'audio') {
      const elMedia = el as HTMLMediaElement;
      const poster = elMedia.getAttribute('poster');
      media.push({
        wcId: selector,
        tag: tag === 'audio' ? 'audio' : 'video',
        currentTime: Number.isFinite(elMedia.currentTime) ? Math.round(elMedia.currentTime * 100) / 100 : 0,
        paused: elMedia.paused,
        volume: elMedia.volume,
        muted: elMedia.muted,
        playbackRate: elMedia.playbackRate,
        duration: Number.isFinite(elMedia.duration) ? elMedia.duration : null,
        loop: elMedia.loop,
        captured: !!elMedia.currentSrc,
        poster: poster ? sanitizeUrlForReport(absolutize(poster, base) || poster) : undefined,
      });
    }
    if (tag === 'canvas') {
      const canvas = el as HTMLCanvasElement;
      let dataUrl = '';
      try {
        dataUrl = canvas.toDataURL('image/png');
      } catch {
        dataUrl = '';
      }
      if (dataUrl && !dataUrl.endsWith(',')) {
        canvases.push({ wcId: selector, width: canvas.width, height: canvas.height, mode: 'image' });
      }
    }
    if (tag === 'details') details.push({ wcId: selector, open: el.hasAttribute('open') });
    if (tag === 'dialog') dialogs.push({ wcId: selector, open: el.hasAttribute('open') });
    if (el.hasAttribute?.('popover')) {
      let open = false;
      try {
        open = el.matches(':popover-open');
      } catch {
        open = false;
      }
      popovers.push({ wcId: selector, open });
    }
    const scrollTop = el.scrollTop;
    const scrollLeft = el.scrollLeft;
    if (scrollTop > 0 || scrollLeft > 0) {
      scrollables.push({ wcId: selector, target: 'element', top: Math.round(scrollTop), left: Math.round(scrollLeft) });
    }
  }

  state.forms = forms;
  state.scrollables = scrollables;
  state.media = media;
  state.canvases = canvases;
  state.details = details;
  state.dialogs = dialogs;
  state.popovers = popovers;
  return state;
}

function captureForm(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  tag: string,
  selector: string,
): FormFieldState | null {
  if (tag === 'select') {
    const select = el as HTMLSelectElement;
    return {
      wcId: selector,
      tag,
      selectedIndex: select.selectedIndex,
      selectedValues: Array.from(select.selectedOptions ?? []).map((option) => option.value),
    };
  }
  if (tag === 'textarea') {
    const area = el as HTMLTextAreaElement;
    const redaction = shouldRedactField(tag, undefined, area.getAttribute('autocomplete') || undefined);
    if (redaction.redact) return { wcId: selector, tag, redacted: true, excludedReason: redaction.reason };
    return { wcId: selector, tag, value: area.value };
  }
  const input = el as HTMLInputElement;
  const type = input.type?.toLowerCase();
  const redaction = shouldRedactField(tag, type, input.getAttribute('autocomplete') || undefined);
  if (type === 'checkbox' || type === 'radio') {
    return { wcId: selector, tag, type, checked: input.checked };
  }
  if (type === 'file') {
    return { wcId: selector, tag, type, excludedReason: 'input file (no reconstruible)' };
  }
  if (redaction.redact) {
    return {
      wcId: selector,
      tag,
      type,
      redacted: true,
      excludedReason: redaction.reason,
      value: type === 'password' ? maskValue(input.value || 'password') : undefined,
    };
  }
  return { wcId: selector, tag, type, value: input.value };
}
