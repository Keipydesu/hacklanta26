/** Builds the self-contained WebView page: pinned MapLibre, the page script and the basemap style URL. */
import type { LngLat } from './protocol';

export type PageAssets = { main: string; shared: string; worker: string; css: string; sharedImport: string; pageScript: string };
export type PageOptions = { styleUrl: string; center: LngLat; zoom: number; styleTimeoutMs?: number };

const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), 'g');
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'g');
/** JSON is valid JavaScript; escaping every `<` means embedded text can never end the script element. */
export const scriptLiteral = (value: unknown) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(LINE_SEPARATOR, '\\u2028').replace(PARAGRAPH_SEPARATOR, '\\u2029');

const BOOTSTRAP = `
(function () {
  var A = window.__campusAssets;
  var post = function (text) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text); };
  var noticeEl = document.getElementById('notice');
  var setNotice = function (text) { noticeEl.textContent = text; noticeEl.style.display = text ? 'block' : 'none'; };
  var css = document.createElement('style'); css.textContent = A.css; document.head.appendChild(css);
  var blob = function (code) { return URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); };
  var shared = blob(A.shared);
  var rewrite = function (code) { return code.split(A.sharedImport).join(JSON.stringify(shared)); };
  var workerUrl = blob(rewrite(A.worker));
  var mainUrl = blob(rewrite(A.main));
  import(mainUrl).then(function (ml) {
    ml.setWorkerUrl(workerUrl);
    var api = startCampusMap(ml, { container: 'map', document: document, post: post, notice: setNotice,
      setTimeout: function (fn, ms) { return window.setTimeout(fn, ms); },
      styleUrl: A.options.styleUrl, center: A.options.center, zoom: A.options.zoom, styleTimeoutMs: A.options.styleTimeoutMs });
    window.__campusMap = api;
    api.ready();
  }).catch(function (error) {
    setNotice('Map could not start: ' + error);
    post(JSON.stringify({ type: 'basemap', status: 'unavailable', detail: String(error) }));
  });
})();
`;

export function renderMapPage(assets: PageAssets, options: PageOptions): string {
  const data = { css: assets.css, shared: assets.shared, worker: assets.worker, main: assets.main, sharedImport: assets.sharedImport,
    options: { ...options, styleTimeoutMs: options.styleTimeoutMs ?? 12_000 } };
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">'
    + '<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#e9e7e1}'
    + '#notice{display:none;position:absolute;top:8px;left:8px;right:8px;z-index:2;padding:6px 10px;border-radius:6px;'
    + 'background:rgba(255,255,255,.92);color:#765000;font:13px -apple-system,Roboto,sans-serif}</style></head>'
    + '<body><div id="map"></div><div id="notice"></div>'
    + `<script>window.__campusAssets = ${scriptLiteral(data)};</script>`
    + `<script>${assets.pageScript.replace(/<\//g, '<\\/')}</script>`
    + `<script>${BOOTSTRAP}</script>`
    + '</body></html>';
}
