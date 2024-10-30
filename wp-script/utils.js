export function getFilename(url) {
  try {
    return url.split('/').pop().split('#')[0].split('?')[0];
  } catch (error) {
    console.error('Failed to extract filename:', error);
    return null;
  }
};

export function isValidNode(node) {
  return node && typeof node === 'object' && typeof node.type === 'string';
}

export function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

export function isBoldMarkdown(text) {
  const boldPattern = /(\*\*|__)(.*?)\1/g;
  return boldPattern.test(text);
}

export function normalizeUrl(url) {
  try {
    // Remove query parameters and hash
    const cleanUrl = url.split(/[?#]/)[0].toLowerCase();
    
    // Remove common URL parameters and variations
    return cleanUrl
      .replace(/\/(quality|width|height)\/\d+\//g, '/') // Remove size parameters
      .replace(/[-_]\d+x\d+/g, '')  // Remove dimensions in filename
      .replace(/\/(small|medium|large|thumbnail)\//g, '/') // Remove size indicators
      .replace(/\/{2,}/g, '/'); // Replace multiple slashes with single slash
  } catch (error) {
    console.error('Invalid URL:', url);
    return url;
  }
};

export function normalizeFilename(filename) {
  return filename
    .toLowerCase()
    .replace(/[_-]/g, '') // Remove underscores and hyphens
    .replace(/\.[^/.]+$/, ''); // Remove extension
};