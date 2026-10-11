/*
 * Runs inside the map WebView (and in Node tests with a fake MapLibre). Plain ES5-style script so
 * it can be inlined into the page and evaluated without a bundler.
 *
 * Overlays never depend on the remote basemap: markers are DOM elements, and the GeoJSON layers are
 * (re)added on every style load, including the local blank style used when tiles are unreachable.
 */
function startCampusMap(ml, env) {
  var EMPTY = { type: 'FeatureCollection', features: [] };
  var overlay = { hazards: [], markers: [], routes: [] };
  var markers = {};
  var currentTheme = 'light';
  var cameraRevision = -1;
  var cameraPaused = false;
  var cameraNeedsZoom = true;
  var styleGeneration = 0;
  var styleLoadHandler = null;
  var styleErrorHandler = null;
  var basemapSettled = false;
  // Set on style.load; map.isStyleLoaded() stays false until every basemap tile source loads.
  var styleReady = false;

  function post(message) { env.post(JSON.stringify(message)); }
  function notice(text) { env.notice(text); }

  var map = new ml.Map({ container: env.container, style: env.styleUrl, center: env.center, zoom: env.zoom, attributionControl: { compact: true } });

  function fallback(detail) {
    if (basemapSettled) return;
    basemapSettled = true;
    notice('Basemap unavailable · hazards, pins and routes are still shown');
    styleReady = false;
    map.setStyle({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background',
      paint: { 'background-color': currentTheme === 'dark' ? '#11151b' : '#e9e7e1' } }] }, { diff: false });
    post({ type: 'basemap', status: 'unavailable', detail: String(detail || 'unknown error') });
  }

  function beginStyle(url) {
    var generation = ++styleGeneration;
    if (styleLoadHandler) map.off('style.load', styleLoadHandler);
    if (styleErrorHandler) map.off('error', styleErrorHandler);
    basemapSettled = false;
    styleReady = false;
    notice('');
    styleLoadHandler = function () {
      if (generation !== styleGeneration) return;
      styleReady = true;
      if (!basemapSettled) { basemapSettled = true; post({ type: 'basemap', status: 'loaded' }); }
      renderLayers();
    };
    styleErrorHandler = function (event) {
      if (generation === styleGeneration && !basemapSettled && !styleReady) fallback(event && event.error && event.error.message);
    };
    map.on('style.load', styleLoadHandler);
    map.on('error', styleErrorHandler);
    env.setTimeout(function () {
      if (generation === styleGeneration && !basemapSettled) fallback('basemap style timed out');
    }, env.styleTimeoutMs);
    if (url) map.setStyle(url, { diff: false });
  }

  function ensureLayers() {
    if (!map.getSource('bike-lanes')) {
      map.addSource('bike-lanes', { type: 'geojson', data: env.bikeLanes, attribution: '© OpenStreetMap contributors' });
      var firstSymbol = map.getStyle().layers.find(function (layer) { return layer.type === 'symbol'; });
      map.addLayer({ id: 'bike-lanes', type: 'line', source: 'bike-lanes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': env.bikeLaneColors[currentTheme],
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2.5], 'line-opacity': 0.48 } },
      firstSymbol && firstSymbol.id);
    }
    if (!map.getSource('hazards')) {
      map.addSource('hazards', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'hazard-fill', type: 'fill', source: 'hazards',
        paint: { 'fill-color': ['match', ['get', 'source'], 'manual', '#fa9f42', '#7777dd'], 'fill-opacity': 0.4 } });
      map.addLayer({ id: 'hazard-line', type: 'line', source: 'hazards',
        paint: { 'line-color': ['match', ['get', 'source'], 'manual', currentTheme === 'dark' ? '#ffad66' : '#af4d00',
          currentTheme === 'dark' ? '#b7a7ff' : '#5555bb'], 'line-width': 2 } });
    }
    if (!map.getSource('routes')) {
      map.addSource('routes', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'route-solid', type: 'line', source: 'routes', filter: ['!', ['get', 'dashed']],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] } });
      map.addLayer({ id: 'route-dashed', type: 'line', source: 'routes', filter: ['get', 'dashed'],
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-dasharray': [2.5, 2] } });
    }
  }

  function popupContent(m) {
    var root = env.document.createElement('div');
    var title = env.document.createElement('strong');
    title.textContent = m.title;
    root.appendChild(title);
    if (m.description) {
      var description = env.document.createElement('div');
      description.textContent = m.description;
      root.appendChild(description);
    }
    return root;
  }

  // Trusted, bundled pictograms only. Report labels never become markup.
  var iconPaths = {
    pothole: 'M3 12C3 5 21 5 21 12S3 19 3 12ZM8 12h8',
    obstruction: 'M8 17l4-13 4 13M6 20h12M9 13h6M10 9h4',
    closure: 'M4 6h16v10H4ZM7 16v5M17 16v5M5 14l7-7M12 15l7-7',
    other: 'M12 4v10M12 19v1',
    braking: 'M7 3h10l4 5v8l-4 5H7l-4-5V8ZM12 7v7M12 17v1',
    surface: 'M3 8l4-3 5 6 5-6 4 3M3 17l4-3 5 6 5-6 4 3',
    abandoned: 'M6 3v18M18 3v18M12 3v4M12 11v3M12 18v3M3 21L21 3'
  };
  function markerElement(m) {
    var el = env.document.createElement('div');
    var location = m.icon === 'location' || m.dot;
    el.style.cssText = 'width:48px;height:48px;display:flex;align-items:center;justify-content:center;cursor:pointer;';
    var badge = env.document.createElement('div');
    badge.style.cssText = 'box-sizing:border-box;display:flex;align-items:center;justify-content:center;border:3px solid white;border-radius:50%;box-shadow:0 2px 5px #0005;';
    badge.style.width = badge.style.height = location ? '22px' : '36px';
    badge.style.backgroundColor = m.color;
    if (location) badge.style.boxShadow = '0 0 0 7px #2b6cd433,0 1px 4px #0005';
    else {
      var svg = env.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '23'); svg.setAttribute('height', '23');
      svg.setAttribute('aria-hidden', 'true');
      var path = env.document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', iconPaths[m.icon] || iconPaths.other);
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#fff');
      path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path); badge.appendChild(svg);
    }
    el.appendChild(badge);
    return el;
  }

  function renderMarkers() {
    var seen = {};
    overlay.markers.forEach(function (m) {
      seen[m.id] = true;
      var marker = markers[m.id];
      if (marker && (marker.campusColor !== m.color || marker.campusIcon !== m.icon || marker.campusDot !== m.dot)) { marker.remove(); marker = null; }
      if (!marker) {
        marker = new ml.Marker(m.icon || m.dot
          ? { element: markerElement(m), anchor: 'center', draggable: !!m.draggable }
          : { color: m.color, draggable: !!m.draggable });
        marker.campusIcon = m.icon; marker.campusDot = m.dot;
        marker.campusColor = m.color;
        marker.on('dragstart', function () { marker.campusDragging = true; cameraPaused = true; post({ type: 'gesture' }); });
        marker.on('dragend', function () {
          marker.campusDragging = false;
          var p = marker.getLngLat();
          post({ type: 'drag', id: m.id, position: [p.lng, p.lat] });
        });
        if (m.select) {
          marker.getElement().addEventListener('click', function (event) {
            event.stopPropagation();
            post({ type: 'select', id: m.select });
          });
          marker.getElement().addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); event.stopPropagation();
              post({ type: 'select', id: m.select });
            }
          });
        }
        marker.setLngLat(m.position).addTo(map);
        markers[m.id] = marker;
      } else if (!marker.campusDragging) {
        marker.setLngLat(m.position);
      }
      var element = marker.getElement();
      element.setAttribute('aria-label', m.title + (m.description ? ': ' + m.description : ''));
      element.setAttribute('role', 'button'); element.tabIndex = 0;
      marker.setDraggable(!!m.draggable);
      if (m.select) return;
      var popup = marker.getPopup();
      if (!popup) { popup = new ml.Popup({ offset: 25, closeButton: false }); marker.setPopup(popup); }
      popup.setDOMContent(popupContent(m));
    });
    Object.keys(markers).forEach(function (id) {
      if (!seen[id]) { markers[id].remove(); delete markers[id]; }
    });
  }

  function renderLayers() {
    if (!styleReady) return;
    ensureLayers();
    map.getSource('hazards').setData({ type: 'FeatureCollection', features: overlay.hazards.map(function (h) {
      return { type: 'Feature', properties: { id: h.id, source: h.source }, geometry: { type: 'Polygon', coordinates: h.rings } };
    }) });
    map.getSource('routes').setData({ type: 'FeatureCollection', features: overlay.routes.map(function (r) {
      return { type: 'Feature', properties: { id: r.id, color: r.color, width: r.width, dashed: r.dashed }, geometry: { type: 'LineString', coordinates: r.coordinates } };
    }) });
  }

  function render() { renderMarkers(); renderLayers(); }

  function postBounds() {
    var b = map.getBounds();
    post({ type: 'bounds', bounds: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() } });
  }

  map.on('click', function (event) {
    var target = event.originalEvent && event.originalEvent.target;
    if (target && target !== map.getCanvas()) return; // a marker or popup tap is not a map tap
    post({ type: 'press', position: [event.lngLat.lng, event.lngLat.lat] });
  });
  map.on('movestart', function (event) {
    if (event && event.originalEvent) { cameraPaused = true; post({ type: 'gesture' }); }
  });
  map.on('moveend', postBounds);
  map.on('load', postBounds);
  beginStyle(null);

  return {
    receive: function (message) {
      if (message && message.type === 'camera' && message.camera) {
        var camera = message.camera;
        var recenter = camera.revision !== cameraRevision;
        if (recenter) { cameraRevision = camera.revision; cameraPaused = false; cameraNeedsZoom = true; }
        if (camera.follow && camera.position && !cameraPaused) {
          var target = { center: camera.position, duration: 350 };
          if (cameraNeedsZoom) { target.zoom = Math.max(map.getZoom(), 16); cameraNeedsZoom = false; }
          map.easeTo(target);
        }
      }
      if (message && message.type === 'overlay' && message.overlay) { overlay = message.overlay; render(); }
      if (message && message.type === 'theme' && (message.theme === 'light' || message.theme === 'dark') && message.theme !== currentTheme) {
        currentTheme = message.theme;
        beginStyle(currentTheme === 'dark' ? env.darkStyleUrl : env.styleUrl);
      }
    },
    ready: function () { post({ type: 'ready' }); postBounds(); },
  };
}

if (typeof module !== 'undefined') module.exports = { startCampusMap: startCampusMap };
