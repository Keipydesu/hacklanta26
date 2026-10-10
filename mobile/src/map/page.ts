/** The real map page: pinned MapLibre assets from the generated bundle plus the page script. */
import { renderMapPage, type PageOptions } from './html';
import { MAP_PAGE_SCRIPT, MAPLIBRE_CSS, MAPLIBRE_MAIN, MAPLIBRE_SHARED, MAPLIBRE_SHARED_IMPORT, MAPLIBRE_WORKER } from './maplibreBundle.generated';

export const buildMapHtml = (options: PageOptions) => renderMapPage({
  main: MAPLIBRE_MAIN, shared: MAPLIBRE_SHARED, worker: MAPLIBRE_WORKER, css: MAPLIBRE_CSS,
  sharedImport: MAPLIBRE_SHARED_IMPORT, pageScript: MAP_PAGE_SCRIPT,
}, options);
