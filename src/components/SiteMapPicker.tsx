import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Crosshair } from "lucide-react";
import { toast } from "sonner";

// Fix Leaflet's default marker icons (Vite doesn't resolve them by default).
const markerIcon = new L.Icon({
  iconUrl:
    "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:
    "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

type Props = {
  latitude: number | null;
  longitude: number | null;
  radiusM: number;
  onChange: (lat: number, lng: number) => void;
  height?: number;
};

const DEFAULT_CENTER: [number, number] = [-26.2041, 28.0473]; // Johannesburg

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function Recenter({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat != null && lng != null) {
      map.setView([lat, lng], Math.max(map.getZoom(), 15));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);
  return null;
}

export function SiteMapPicker({
  latitude,
  longitude,
  radiusM,
  onChange,
  height = 320,
}: Props) {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const markerRef = useRef<L.Marker>(null);

  const center = useMemo<[number, number]>(
    () =>
      latitude != null && longitude != null
        ? [latitude, longitude]
        : DEFAULT_CENTER,
    // Only compute initial center once — later updates use <Recenter />.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const geocode = async () => {
    const q = search.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { Accept: "application/json" } },
      );
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        toast.error("No results");
        return;
      }
      const hit = data[0];
      onChange(parseFloat(hit.lat), parseFloat(hit.lon));
    } catch (e: any) {
      toast.error(e?.message ?? "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not available");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => onChange(p.coords.latitude, p.coords.longitude),
      (err) => toast.error(err.message || "Location denied"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void geocode();
              }
            }}
            placeholder="Search address or place…"
            className="pl-8"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={geocode}
          disabled={searching}
        >
          {searching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "Search"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={useMyLocation}
          title="Use my location"
        >
          <Crosshair className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div
        className="rounded-md overflow-hidden border border-border"
        style={{ height }}
      >
        <MapContainer
          center={center}
          zoom={latitude != null ? 15 : 11}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onPick={onChange} />
          <Recenter lat={latitude} lng={longitude} />
          {latitude != null && longitude != null && (
            <>
              <Marker
                ref={markerRef}
                position={[latitude, longitude]}
                draggable
                icon={markerIcon}
                eventHandlers={{
                  dragend: () => {
                    const m = markerRef.current;
                    if (!m) return;
                    const p = m.getLatLng();
                    onChange(p.lat, p.lng);
                  },
                }}
              />
              <Circle
                center={[latitude, longitude]}
                radius={Math.max(10, radiusM)}
                pathOptions={{
                  color: "hsl(var(--primary))",
                  fillColor: "hsl(var(--primary))",
                  fillOpacity: 0.15,
                }}
              />
            </>
          )}
        </MapContainer>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Click, drag the pin, or search. Circle shows the geofence radius.
      </p>
    </div>
  );
}
