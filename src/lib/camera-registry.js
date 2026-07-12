/**
 * Global MediaStream registry so camera hardware is always releasable
 * even if a tool instance is torn down or getUserMedia resolves late.
 */

/** @type {Set<MediaStream>} */
const liveStreams = new Set();

/**
 * Stop every track on a stream (best-effort).
 * @param {MediaStream | null | undefined} stream
 */
export function stopStreamTracks(stream) {
  if (!stream || typeof stream.getTracks !== 'function') return;
  const tracks = [
    ...stream.getTracks(),
    ...(typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : []),
    ...(typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : [])
  ];
  // Dedupe by id
  const seen = new Set();
  for (const track of tracks) {
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Register a live stream so it can be force-released later.
 * @param {MediaStream} stream
 * @returns {MediaStream}
 */
export function registerMediaStream(stream) {
  if (stream && typeof stream.getTracks === 'function') {
    liveStreams.add(stream);
  }
  return stream;
}

/**
 * Unregister after intentional stop.
 * @param {MediaStream | null | undefined} stream
 */
export function unregisterMediaStream(stream) {
  if (stream) liveStreams.delete(stream);
}

/**
 * Detach and stop a stream from a video element.
 * @param {HTMLVideoElement | null | undefined} video
 */
export function detachVideoStream(video) {
  if (!video) return;
  try {
    const attached = video.srcObject;
    if (attached) {
      stopStreamTracks(attached);
      unregisterMediaStream(attached);
    }
  } catch {
    /* ignore */
  }
  try {
    video.pause();
  } catch {
    /* ignore */
  }
  try {
    video.srcObject = null;
    video.removeAttribute('src');
    video.load();
  } catch {
    /* ignore */
  }
}

/**
 * Force-stop every registered stream and any <video> still holding a MediaStream.
 * Safe to call multiple times.
 */
export function releaseAllCameras() {
  for (const stream of [...liveStreams]) {
    stopStreamTracks(stream);
    liveStreams.delete(stream);
  }
  try {
    document.querySelectorAll('video').forEach((video) => {
      if (video.srcObject) detachVideoStream(video);
    });
  } catch {
    /* ignore */
  }
}
