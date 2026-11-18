const status = document.getElementById('status');
const list = document.getElementById('api-list');
const moduleStatus = document.getElementById('module-status');
const moduleBox = document.getElementById('module-box');

fetch('api/data.json')
  .then((response) => response.json())
  .then((data) => {
    if (list) {
      list.innerHTML = '';
      for (const item of data.items) {
        const li = document.createElement('li');
        li.textContent = item.name + ' · ' + item.value;
        list.appendChild(li);
      }
    }
    if (status) {
      status.textContent = 'datos cargados';
      status.className = 'badge ok';
    }
  })
  .catch(() => {
    if (status) {
      status.textContent = 'error de datos';
      status.className = 'badge pending';
    }
  });

setTimeout(() => {
  import('./lazy-module.mjs')
    .then((mod) => {
      if (moduleBox) mod.mount(moduleBox);
      if (moduleStatus) {
        moduleStatus.textContent = 'módulo cargado';
        moduleStatus.className = 'badge ok';
      }
    })
    .catch(() => {
      if (moduleStatus) moduleStatus.textContent = 'módulo no disponible';
    });
}, 150);

// Estado persistente + POST real: el Clon Completo debe restaurar ambos.
const sessionButton = document.getElementById('session-add');
const sessionCountEl = document.getElementById('session-count');
const sessionList = document.getElementById('session-list');
let sessionCount = Number(localStorage.getItem('wc-full-count') || '0') || 0;
let sessionItems = [];
try {
  sessionItems = JSON.parse(localStorage.getItem('wc-full-items') || '[]');
  if (!Array.isArray(sessionItems)) sessionItems = [];
} catch {
  sessionItems = [];
}
function renderSession() {
  if (sessionCountEl) sessionCountEl.textContent = String(sessionCount);
  if (!sessionList) return;
  sessionList.innerHTML = '';
  for (const item of sessionItems) {
    const li = document.createElement('li');
    li.textContent = String(item);
    sessionList.appendChild(li);
  }
}
renderSession();
if (sessionButton) {
  sessionButton.addEventListener('click', () => {
    const label = 'Red ' + (sessionCount + 1);
    sessionButton.disabled = true;
    fetch('api/session-add.json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label })
    })
      .then((response) => response.json())
      .then((data) => {
        sessionItems.push(data && data.label ? data.label : label);
        sessionCount += 1;
        localStorage.setItem('wc-full-count', String(sessionCount));
        localStorage.setItem('wc-full-items', JSON.stringify(sessionItems));
        renderSession();
      })
      .catch(() => {
        sessionButton.textContent = 'red no disponible';
      })
      .finally(() => {
        sessionButton.disabled = false;
      });
  });
}
