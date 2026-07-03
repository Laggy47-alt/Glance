import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

interface Props {
  hlsUrl: string;
  mjpegUrl: string;
  alt: string;
  className?: string;
  muted?: boolean;
}

/**
 * Fluent live view. Tries LL-HLS via hls.js first (fMP4 segments served by the
 * bridge's ffmpeg). Falls back to the MJPEG snapshot stream if HLS fails to
 * start within a few seconds (typical when the camera has no RTSP channel
 * enabled, or ffmpeg isn't installed on the bridge machine).
 */
export function UnifiHlsPlayer({ hlsUrl, mjpegUrl, alt, className, muted = true }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    let cancelled = false;

    // Give HLS ~6s to produce a playable manifest before dropping to MJPEG.
    const failTimer = window.setTimeout(() => { if (!cancelled) setFailed(true); }, 6000);
    const cancelFail = () => window.clearTimeout(failTimer);

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari / iOS — native HLS.
      video.src = hlsUrl;
      video.addEventListener("loadeddata", cancelFail, { once: true });
      video.addEventListener("error", () => setFailed(true), { once: true });
    } else if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 5,
        maxBufferLength: 6,
        backBufferLength: 4,
        manifestLoadingTimeOut: 6000,
        manifestLoadingMaxRetry: 4,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { cancelFail(); void video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data?.fatal) setFailed(true);
      });
    } else {
      setFailed(true);
    }

    return () => {
      cancelled = true;
      cancelFail();
      try { hls?.destroy(); } catch {}
      if (video) { video.removeAttribute("src"); video.load(); }
    };
  }, [hlsUrl]);

  if (failed) {
    return <img src={mjpegUrl} alt={alt} className={className} />;
  }
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      controls={false}
      className={className}
    />
  );
}
