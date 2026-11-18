export function mount(element) {
  element.textContent = 'lazy module ejecutado';
  element.dataset.ejecutado = 'true';
}
