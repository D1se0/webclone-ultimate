(function () {
  'use strict';

  var canvas = document.getElementById('lienzo');
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext('2d');
    var gradient = ctx.createLinearGradient(0, 0, 320, 100);
    gradient.addColorStop(0, '#0b0b0d');
    gradient.addColorStop(1, '#ef4444');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 320, 100);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('JS dibuja canvas', 56, 58);
  }

  var host = document.getElementById('host');
  if (host && host.attachShadow) {
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>.box{padding:12px;border:1px solid #333;border-radius:10px;background:#f5f5f7;font:13px system-ui}</style>' +
      '<div class="box"><strong>Shadow DOM</strong><p>Reconstruido por JavaScript.</p></div>';
  }

  var nombre = document.getElementById('nombre');
  if (nombre) nombre.value = 'Grace Hopper';

  var count = 0;
  var counter = document.getElementById('count');
  var list = document.getElementById('interactive-list');
  var add = document.getElementById('add-row');
  if (add) {
    add.addEventListener('click', function () {
      count++;
      if (counter) counter.textContent = String(count);
      if (list) {
        var item = document.createElement('li');
        item.textContent = 'Fila dinámica ' + count;
        list.appendChild(item);
      }
    });
  }

  var form = document.getElementById('demo-form');
  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (nombre && counter) counter.textContent = String(count);
    });
  }

  var xhr = new XMLHttpRequest();
  xhr.open('GET', 'api/extra.json');
  xhr.onload = function () {
    var badge = document.getElementById('extra-status');
    if (!badge) return;
    try {
      var data = JSON.parse(xhr.responseText);
      badge.textContent = data.label;
      badge.className = 'badge ok';
    } catch (error) {
      badge.textContent = 'extra ilegible';
    }
  };
  xhr.onerror = function () {
    var badge = document.getElementById('extra-status');
    if (badge) badge.textContent = 'extra no disponible';
  };
  xhr.send();
})();
