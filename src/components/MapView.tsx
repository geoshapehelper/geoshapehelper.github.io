import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { LayerMeta, ShapeFC } from '../types';
import { GID, LAYER_ID } from '../types';
import { fcLatLngBounds } from '../geo/geometry';

interface MapViewProps {
  fc: ShapeFC;
  layers: LayerMeta[];
  selectedGids: string[];
  onSelectionChange: (gids: string[]) => void;
  showLabels: boolean;
  baseVisible: boolean;
  baseOpacity: number;
  /** Bump this number to re-fit the map to the data bounds. */
  fitSignal: number;
}

const SELECTED_STYLE: L.PathOptions = {
  color: '#ff6d00',
  weight: 3,
  fillColor: '#ff9e40',
  fillOpacity: 0.5,
  opacity: 1,
};

function baseStyle(color: string): L.PathOptions {
  return { color: '#37474f', weight: 1, fillColor: color, fillOpacity: 0.35, opacity: 0.85 };
}

const LABEL_LIMIT = 600;

export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.TileLayer | null>(null);
  const groupRef = useRef<L.FeatureGroup | null>(null);
  const featureLayersRef = useRef<Map<string, L.Path>>(new Map());

  // Keep latest props reachable from Leaflet event closures.
  const selectedRef = useRef(props.selectedGids);
  const onSelectRef = useRef(props.onSelectionChange);
  const layersRef = useRef(props.layers);
  selectedRef.current = props.selectedGids;
  onSelectRef.current = props.onSelectionChange;
  layersRef.current = props.layers;

  // --- init map (once) ---
  useEffect(() => {
    if (!containerRef.current) return;
    // boxZoom disabled: shift is our multi-select modifier, and Leaflet's
    // shift-drag box-zoom otherwise hijacks shift-clicks into a zoom.
    const map = L.map(containerRef.current, { preferCanvas: true, boxZoom: false }).setView(
      [39, 35],
      6,
    );
    const base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    base.addTo(map);
    const group = L.featureGroup().addTo(map);
    map.on('click', () => onSelectRef.current([]));

    mapRef.current = map;
    baseRef.current = base;
    groupRef.current = group;
    // Container may have been sized after mount (flex layout).
    setTimeout(() => map.invalidateSize(), 0);
    const onResize = () => map.invalidateSize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // --- base layer opacity / visibility ---
  useEffect(() => {
    const map = mapRef.current;
    const base = baseRef.current;
    if (!map || !base) return;
    if (props.baseVisible && !map.hasLayer(base)) base.addTo(map);
    if (!props.baseVisible && map.hasLayer(base)) map.removeLayer(base);
    base.setOpacity(props.baseOpacity);
  }, [props.baseVisible, props.baseOpacity]);

  // --- (re)build feature layers when data / layers / labels change ---
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    const featureLayers = new Map<string, L.Path>();
    featureLayersRef.current = featureLayers;

    const layersById = new Map(props.layers.map((l) => [l.id, l]));
    const withLabels = props.showLabels && props.fc.features.length <= LABEL_LIMIT;
    const metaOf = (f?: GeoJSON.Feature) =>
      layersById.get((f?.properties as Record<string, string> | undefined)?.[LAYER_ID] ?? '');

    // One GeoJSON layer for all features (far less overhead than one per feature).
    L.geoJSON(props.fc as unknown as GeoJSON.FeatureCollection, {
      filter: (feature) => {
        const meta = metaOf(feature);
        return !meta || meta.visible; // skip features on hidden layers
      },
      style: (feature) => {
        const gid = (feature?.properties as Record<string, string>)[GID];
        return selectedRef.current.includes(gid)
          ? SELECTED_STYLE
          : baseStyle(metaOf(feature)?.color ?? '#3388ff');
      },
      onEachFeature: (feature, layer) => {
        const path = layer as L.Path;
        const fprops = feature.properties as Record<string, string>;
        const gid = fprops[GID];
        const meta = metaOf(feature);
        const color = meta?.color ?? '#3388ff';
        featureLayers.set(gid, path);
        path.on('mouseover', () => {
          if (!selectedRef.current.includes(gid)) {
            path.setStyle({ weight: 2.5, fillOpacity: 0.55 });
            path.bringToFront();
          }
        });
        path.on('mouseout', () => {
          if (!selectedRef.current.includes(gid)) path.setStyle(baseStyle(color));
        });
        path.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          const oe = e.originalEvent;
          const multi = oe.shiftKey || oe.ctrlKey || oe.metaKey;
          const cur = selectedRef.current;
          let next: string[];
          if (multi) {
            next = cur.includes(gid) ? cur.filter((g) => g !== gid) : [...cur, gid];
          } else {
            next = cur.length === 1 && cur[0] === gid ? [] : [gid];
          }
          onSelectRef.current(next);
        });
        if (withLabels && meta?.nameField) {
          const name = fprops[meta.nameField];
          if (name != null && String(name).trim() !== '') {
            path.bindTooltip(String(name), {
              permanent: true,
              direction: 'center',
              className: 'feature-label',
            });
          }
        }
      },
    }).addTo(group);
  }, [props.fc, props.layers, props.showLabels]);

  // --- restyle on selection change (no full rebuild) ---
  useEffect(() => {
    const layersById = new Map(props.layers.map((l) => [l.id, l]));
    const selected = new Set(props.selectedGids);
    for (const [gid, path] of featureLayersRef.current) {
      const feature = (path as unknown as { feature?: GeoJSON.Feature }).feature;
      const lid = (feature?.properties as Record<string, string> | undefined)?.[LAYER_ID];
      const color = (lid && layersById.get(lid)?.color) || '#3388ff';
      path.setStyle(selected.has(gid) ? SELECTED_STYLE : baseStyle(color));
      if (selected.has(gid)) path.bringToFront();
    }
  }, [props.selectedGids, props.layers]);

  // --- fit bounds ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = fcLatLngBounds(props.fc);
    if (bounds) map.fitBounds(bounds, { padding: [24, 24] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitSignal]);

  return <div id="map" ref={containerRef} />;
}
