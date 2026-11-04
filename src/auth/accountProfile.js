function googlePhoto(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\p{Cc}]/u.test(value) ||
    !/^https:\/\/lh[3-6]\.googleusercontent\.com\//i.test(value)) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^lh[3-6]\.googleusercontent\.com$/.test(url.hostname) &&
      !url.port && !url.username && !url.password && url.pathname.length > 1 && url.href.length <= 2048 ? url.href : '';
  } catch { return ''; }
}

export function normalizeAccountProfile(value) {
  const profile = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const displayName = typeof profile.displayName === 'string' ? profile.displayName.replace(/\p{Cc}/gu, '').trim().slice(0, 40).trim() : '';
  const photoURL = googlePhoto(profile.photoURL);
  return { displayName, photoURL, sharePhoto: Boolean(photoURL) && profile.sharePhoto === true };
}

export function profileFromGoogle(user) {
  return normalizeAccountProfile({ displayName: user?.displayName, photoURL: user?.photoURL, sharePhoto: false });
}
