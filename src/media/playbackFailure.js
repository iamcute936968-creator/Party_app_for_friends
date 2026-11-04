// Provider codes: developers.google.com/youtube/iframe_api_reference#onError
// Native codes: developer.mozilla.org/en-US/docs/Web/API/MediaError/code
export function playbackFailure(source, value, expired = false) {
  const code = typeof value === 'number' ? value : source === 'youtube' ? value?.data : value?.code;
  if (source === 'youtube') {
    if (code === 100) return { message: 'This YouTube video is unavailable or private. Choose another video.', retryable: false };
    if (code === 101 || code === 150) return { message: 'This YouTube video cannot be embedded. Choose another video.', retryable: false };
    if (code === 153) return { message: 'YouTube could not verify this player. Reload the page or choose another video.', retryable: false };
    if (code === 2) return { message: 'This YouTube link is invalid. Check the link or choose another video.', retryable: false };
    return { message: 'YouTube playback failed. Check your connection and retry.', retryable: true };
  }
  if (expired) return { message: 'This video stream has expired. Renewing playback access.', retryable: true };
  if (source === 'anime' && (code === 3 || code === 4)) return { message: 'This episode’s stream could not play in this browser. Try another episode or device.', retryable: false };
  if (code === 3 || code === 4) return { message: 'This video could not be decoded in this browser. Try an MP4 video with H.264 encoding.', retryable: false };
  return { message: 'Video playback was interrupted. Check your connection and retry.', retryable: true };
}
