// componentes.js — Componentes UI reutilizables compartidos entre viajes.js y viajes_meli.js

// ── Dropdown Simple (selección única con búsqueda, panel en body) ──

function crearDropdownSimple({ opciones = [], placeholder = 'Seleccionar...', mensajeVacio = 'Sin opciones disponibles', onChange = () => {}, deshabilitadosFn = null }) {

  let opcionesActuales    = opciones.slice();
  let valorSeleccionado   = '';
  let labelSeleccionado   = '';
  let opcionSeleccionada  = null;
  let deshabilitado       = false;

  const contenedor = document.createElement('div');
  contenedor.className = 'ds-contenedor';

  const trigger = document.createElement('div');
  trigger.className   = 'ds-trigger';
  trigger.textContent = placeholder;
  contenedor.appendChild(trigger);

  const panel = document.createElement('div');
  panel.className     = 'ds-panel';
  panel.style.display = 'none';
  document.body.appendChild(panel);

  const inputBusqueda = document.createElement('input');
  inputBusqueda.type        = 'text';
  inputBusqueda.className   = 'ds-busqueda';
  inputBusqueda.placeholder = 'Buscar...';
  inputBusqueda.autocomplete = 'off';
  panel.appendChild(inputBusqueda);

  const listaItems = document.createElement('div');
  listaItems.className = 'ds-lista';
  panel.appendChild(listaItems);

  function renderItems(filtro) {
    listaItems.innerHTML = '';
    const deshabilitados = deshabilitadosFn ? deshabilitadosFn() : [];
    const norm = (filtro || '').trim().toLowerCase();
    const filtradas = norm
      ? opcionesActuales.filter(o => o.label.toLowerCase().includes(norm))
      : opcionesActuales;

    if (filtradas.length === 0) {
      const msg = document.createElement('div');
      msg.className   = 'ds-vacio';
      msg.textContent = opcionesActuales.length === 0 ? mensajeVacio : 'Sin resultados para "' + filtro + '"';
      listaItems.appendChild(msg);
      return;
    }

    filtradas.forEach(opcion => {
      const disabled = deshabilitados.includes(opcion.value);
      const item = document.createElement('div');
      item.className = 'ds-item'
        + (opcion.value === valorSeleccionado ? ' ds-item-activo' : '')
        + (disabled ? ' ds-item-disabled' : '');
      item.textContent = opcion.label;
      if (disabled) {
        item.title = 'Ya seleccionado en otra fila';
      } else {
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          valorSeleccionado  = opcion.value;
          labelSeleccionado  = opcion.labelCorto || opcion.label;
          opcionSeleccionada = opcion;
          trigger.textContent = labelSeleccionado;
          trigger.classList.add('ds-trigger-seleccionado');
          trigger.classList.remove('ds-trigger-invalido', 'error');
          cerrar();
          onChange(opcion.value, opcion.label, opcion);
        });
      }
      listaItems.appendChild(item);
    });
  }

  function posicionar() {
    const rect = trigger.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top      = (rect.bottom + 4) + 'px';
    panel.style.left     = rect.left + 'px';
    panel.style.width    = Math.max(rect.width, 260) + 'px';
    panel.style.zIndex   = '9999';
  }

  function abrir() {
    if (deshabilitado) return;
    inputBusqueda.value = '';
    renderItems('');
    posicionar();
    panel.style.display = 'flex';
    inputBusqueda.focus();
  }

  function cerrar() { panel.style.display = 'none'; }

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    panel.style.display === 'none' ? abrir() : cerrar();
  });

  inputBusqueda.addEventListener('input', () => renderItems(inputBusqueda.value));

  document.addEventListener('click', e => {
    if (!contenedor.contains(e.target) && !panel.contains(e.target)) cerrar();
  });

  window.addEventListener('scroll', () => {
    if (panel.style.display !== 'none') posicionar();
  }, true);

  return {
    contenedor,
    wrap:     contenedor,
    input:    trigger,
    getValue:  () => valorSeleccionado,
    getLabel:  () => labelSeleccionado,
    getExtra:  () => opcionSeleccionada ? (opcionSeleccionada.extra || {}) : {},
    setValue(value, labelOverride) {
      const opcion = opcionesActuales.find(o => o.value === value);
      if (opcion) {
        valorSeleccionado  = opcion.value;
        labelSeleccionado  = labelOverride || opcion.labelCorto || opcion.label;
        opcionSeleccionada = opcion;
        trigger.textContent = labelSeleccionado;
        trigger.classList.add('ds-trigger-seleccionado');
        trigger.classList.remove('ds-trigger-invalido', 'error');
        onChange(opcion.value, opcion.label, opcion);
        return true;
      }
      // Valor no encontrado en las opciones — mostrar en naranja
      if (value) {
        valorSeleccionado  = value;
        labelSeleccionado  = labelOverride || value;
        opcionSeleccionada = null;
        trigger.textContent = labelSeleccionado;
        trigger.classList.remove('ds-trigger-seleccionado');
        trigger.classList.add('ds-trigger-invalido');
      }
      return false;
    },
    setOpciones(nuevasOpciones) {
      opcionesActuales = nuevasOpciones.slice();
      if (panel.style.display !== 'none') renderItems(inputBusqueda.value);
    },
    removerOpcion(value) {
      opcionesActuales = opcionesActuales.filter(o => o.value !== value);
    },
    agregarOpcion(opcion) {
      if (!opcionesActuales.find(o => o.value === opcion.value)) {
        opcionesActuales.push(opcion);
        opcionesActuales.sort((a, b) => a.label.localeCompare(b.label));
      }
    },
    reset() {
      valorSeleccionado  = '';
      labelSeleccionado  = '';
      opcionSeleccionada = null;
      trigger.textContent = placeholder;
      trigger.classList.remove('ds-trigger-seleccionado', 'ds-trigger-invalido', 'error');
      cerrar();
    },
    disable() { deshabilitado = true;  trigger.classList.add('ds-trigger-disabled'); },
    enable()  { deshabilitado = false; trigger.classList.remove('ds-trigger-disabled'); }
  };
}

// ── Multi-select (selección múltiple con vigencia, panel en body) ──

function crearMultiSelect({ opciones = [], placeholder = 'Seleccionar...', mensajeVacio = 'Sin opciones disponibles', onChange = () => {} }) {

  function getEtiqueta(op) { return typeof op === 'object' ? op.etiqueta : op; }
  function getVigente(op)  { return typeof op !== 'object' || estaVigente(op.vigenciaDesde, op.vigenciaHasta); }

  let seleccionadas    = [];
  let opcionesActuales = [...opciones];

  const contenedor = document.createElement('div');
  contenedor.className = 'ms-contenedor';

  const pillsDiv = document.createElement('div');
  pillsDiv.className = 'ms-pills';
  contenedor.appendChild(pillsDiv);

  const trigger = document.createElement('div');
  trigger.className   = 'ms-trigger';
  trigger.textContent = placeholder;
  contenedor.appendChild(trigger);

  const panel = document.createElement('div');
  panel.className      = 'ms-panel';
  panel.style.display  = 'none';
  document.body.appendChild(panel);

  const inputFiltro = document.createElement('input');
  inputFiltro.type         = 'text';
  inputFiltro.className    = 'ms-busqueda';
  inputFiltro.placeholder  = 'Buscar...';
  inputFiltro.autocomplete = 'off';
  panel.appendChild(inputFiltro);

  const listaItems = document.createElement('div');
  listaItems.className = 'ms-lista';
  panel.appendChild(listaItems);

  function renderPills() {
    pillsDiv.innerHTML = '';
    seleccionadas.forEach(val => {
      const opcion  = opcionesActuales.find(o => getEtiqueta(o) === val);
      const vigente = opcion ? getVigente(opcion) : true;
      const pill  = document.createElement('span');
      pill.className = 'ms-pill' + (vigente ? '' : ' ms-pill--vencida');
      if (!vigente) pill.title = 'Fuera de período de vigencia';
      const texto = document.createElement('span');
      texto.textContent = val;
      const x = document.createElement('span');
      x.className   = 'ms-pill-x';
      x.textContent = '×';
      x.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        seleccionadas = seleccionadas.filter(s => s !== val);
        renderPills();
        renderPanel(inputFiltro.value);
        onChange([...seleccionadas]);
      });
      pill.appendChild(texto);
      pill.appendChild(x);
      pillsDiv.appendChild(pill);
    });
    trigger.textContent = seleccionadas.length === 0 ? placeholder : seleccionadas.length + ' seleccionada(s)';
  }

  function renderPanel(filtro) {
    listaItems.innerHTML = '';
    const norm = (filtro || '').trim().toLowerCase();
    const filtradas = norm
      ? opcionesActuales.filter(o => getEtiqueta(o).toLowerCase().includes(norm))
      : opcionesActuales;

    if (filtradas.length === 0) {
      const msg = document.createElement('div');
      msg.className   = 'ms-vacio';
      msg.textContent = opcionesActuales.length === 0 ? mensajeVacio : 'Sin resultados para "' + filtro + '"';
      listaItems.appendChild(msg);
      return;
    }
    filtradas.forEach(opcion => {
      const etiqueta = getEtiqueta(opcion);
      const vigente  = getVigente(opcion);
      const item     = document.createElement('label');
      item.className = 'ms-item';
      item.style.cssText = 'display:flex;flex-direction:row;align-items:flex-start;gap:10px;cursor:pointer;width:100%;box-sizing:border-box;';
      if (!vigente) item.title = 'Fuera de período de vigencia';
      const checkbox = document.createElement('input');
      checkbox.type      = 'checkbox';
      checkbox.className = 'ms-checkbox';
      checkbox.value     = etiqueta;
      checkbox.checked   = seleccionadas.includes(etiqueta);
      checkbox.style.cssText = 'width:16px;height:16px;min-width:16px;flex-shrink:0;margin:0;margin-top:2px;cursor:pointer;';
      checkbox.addEventListener('change', function() {
        if (checkbox.checked) {
          if (!seleccionadas.includes(etiqueta)) seleccionadas.push(etiqueta);
        } else {
          seleccionadas = seleccionadas.filter(s => s !== etiqueta);
        }
        renderPills();
        onChange([...seleccionadas]);
      });
      const labelTexto     = document.createElement('span');
      labelTexto.className = 'ms-item-texto' + (vigente ? '' : ' ms-item-texto--vencida');
      labelTexto.textContent = etiqueta;
      labelTexto.style.cssText = 'flex:1;word-break:break-word;white-space:normal;line-height:1.4;';
      item.appendChild(checkbox);
      item.appendChild(labelTexto);
      listaItems.appendChild(item);
    });
  }

  function posicionar() {
    const rect         = trigger.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top      = (rect.bottom + 4) + 'px';
    panel.style.left     = rect.left + 'px';
    panel.style.width    = Math.max(rect.width, 260) + 'px';
    panel.style.zIndex   = '9999';
  }

  function abrir() {
    inputFiltro.value = '';
    renderPanel('');
    posicionar();
    panel.style.display = 'flex';
    inputFiltro.focus();
  }

  function cerrar() {
    panel.style.display = 'none';
  }

  trigger.addEventListener('click', function(e) {
    e.stopPropagation();
    if (panel.style.display === 'none') { abrir(); } else { cerrar(); }
  });

  inputFiltro.addEventListener('input', () => renderPanel(inputFiltro.value));

  document.addEventListener('click', function(e) {
    if (!contenedor.contains(e.target) && !panel.contains(e.target)) cerrar();
  });

  window.addEventListener('scroll', function() {
    if (panel.style.display !== 'none') posicionar();
  }, true);

  renderPills();

  return {
    contenedor,
    getValores:   () => [...seleccionadas],
    setOpciones:  function(nuevasOpciones) {
      opcionesActuales = [...nuevasOpciones];
      seleccionadas    = seleccionadas.filter(s => opcionesActuales.some(o => getEtiqueta(o) === s));
      renderPills();
      if (panel.style.display !== 'none') renderPanel(inputFiltro.value);
    },
    setSeleccion: function(vals) {
      seleccionadas = vals.filter(v => opcionesActuales.some(o => getEtiqueta(o) === v));
      renderPills();
      onChange([...seleccionadas]);
    },
    reset: function() {
      seleccionadas    = [];
      opcionesActuales = [];
      renderPills();
      cerrar();
    }
  };
}
