"use client";

import { useEffect, useRef } from "react";
import type {
  Icon,
  Map as LeafletMap,
  Marker as LeafletMarker,
} from "leaflet";
import "leaflet/dist/leaflet.css";

/** Antigua-ish default when coords are empty but the map is shown for placement. */
const DEFAULT_CENTER = { lat: 17.1274, lng: -61.8468 };
const DEFAULT_ZOOM = 11;
const PIN_ZOOM = 15;

function parseCoord(value: string, min: number, max: number) {
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function markerIcon(L: {
  icon: (options: {
    iconUrl: string;
    iconRetinaUrl: string;
    shadowUrl: string;
    iconSize: [number, number];
    iconAnchor: [number, number];
    popupAnchor: [number, number];
    shadowSize: [number, number];
  }) => Icon;
}) {
  // Next/webpack does not serve Leaflet's default marker assets from node_modules.
  return L.icon({
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });
}

/**
 * OpenStreetMap + Leaflet preview. No API key.
 * Optional click-to-place updates lat/lng; never geocodes or routes.
 * Remount with a React `key` when the dialog target changes.
 */
export function LocationMapPreview({
  latitude,
  longitude,
  interactive = false,
  onPositionChange,
}: {
  latitude: string;
  longitude: string;
  interactive?: boolean;
  onPositionChange?: (latitude: string, longitude: string) => void;
}) {
  const lat = parseCoord(latitude, -90, 90);
  const lng = parseCoord(longitude, -180, 180);
  const hasPin = lat !== null && lng !== null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const onChangeRef = useRef(onPositionChange);
  const coordsRef = useRef({ lat, lng });
  onChangeRef.current = onPositionChange;
  coordsRef.current = { lat, lng };

  async function syncMarker(
    map: LeafletMap,
    nextLat: number,
    nextLng: number,
  ) {
    const L = (await import("leaflet")).default;
    const icon = markerIcon(L);
    if (!markerRef.current) {
      markerRef.current = L.marker([nextLat, nextLng], { icon }).addTo(map);
    } else {
      markerRef.current.setLatLng([nextLat, nextLng]);
    }
    map.setView([nextLat, nextLng], Math.max(map.getZoom(), PIN_ZOOM));
    map.invalidateSize();
  }

  // Create once per interactive mode; destroy on unmount. Fixed dependency length.
  useEffect(() => {
    let cancelled = false;
    let resizeTimer: number | undefined;

    async function setup() {
      if (!containerRef.current || mapRef.current) return;
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], DEFAULT_ZOOM);

      // OSM.org and CARTO public CDNs block or require keys for app clients.
      // Esri World Street Map is a no-key raster XYZ suitable for light admin previews.
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution:
            'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, TomTom, FAO, NOAA, USGS',
        },
      ).addTo(map);

      if (interactive) {
        const icon = markerIcon(L);
        map.on("click", (event) => {
          const nextLat = event.latlng.lat.toFixed(6);
          const nextLng = event.latlng.lng.toFixed(6);
          if (!markerRef.current) {
            markerRef.current = L.marker(event.latlng, { icon }).addTo(map);
          } else {
            markerRef.current.setLatLng(event.latlng);
          }
          onChangeRef.current?.(nextLat, nextLng);
        });
      }

      mapRef.current = map;
      const current = coordsRef.current;
      if (current.lat !== null && current.lng !== null) {
        await syncMarker(map, current.lat, current.lng);
      }
      if (cancelled) return;
      requestAnimationFrame(() => map.invalidateSize());
      resizeTimer = window.setTimeout(() => map.invalidateSize(), 120);
    }

    void setup();

    return () => {
      cancelled = true;
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
  }, [interactive]);

  // Keep pin in sync with form fields. Always exactly two deps.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || lat === null || lng === null) return;
    let cancelled = false;
    void syncMarker(map, lat, lng).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return (
    <div className="location-map-preview">
      <div
        ref={containerRef}
        className="location-map-preview-canvas"
        role="img"
        aria-label={
          hasPin
            ? `Map preview at ${lat}, ${lng}`
            : "Map preview — click to place a pin"
        }
      />
      <p className="muted location-map-preview-caption">
        {interactive
          ? hasPin
            ? "Map preview (Esri). Click the map to move the pin."
            : "Map preview (Esri). Click the map to place a pin."
          : hasPin
            ? "Map preview (Esri)."
            : "Enter latitude and longitude to preview the pin."}
      </p>
    </div>
  );
}
