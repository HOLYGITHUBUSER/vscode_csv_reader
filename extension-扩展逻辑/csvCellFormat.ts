export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m] as string);
}

export function escapeCss(text: string): string {
  return text.replace(/[\\"]/g, m => (m === '\\' ? '\\\\' : '\\"'));
}

export function jsonForScriptTag(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function isAllowedExternalScheme(scheme: string): boolean {
  const normalized = scheme.toLowerCase();
  return normalized === 'http' || normalized === 'https' || normalized === 'ftp' || normalized === 'mailto';
}

export function isAllowedExternalUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') return false;
  const value = rawUrl.trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
    return isAllowedExternalScheme(scheme);
  } catch {
    return false;
  }
}

export function linkifyUrls(escapedText: string): string {
  const urlPattern = /\b(?:(?:https?:\/\/|ftp:\/\/|mailto:)[^\s<>&"']+(?:&amp;[^\s<>&"']+)*|www\.[^\s<>&"']+\.[^\s<>&"']+)/gi;
  return escapedText.replace(urlPattern, (rawMatch) => {
    let matched = rawMatch;
    let trailing = '';
    const trailingMatch = matched.match(/[.,!?;:)\]]+$/);
    if (trailingMatch) {
      trailing = trailingMatch[0];
      matched = matched.slice(0, -trailing.length);
    }
    if (!matched) return rawMatch;

    let href = matched.replace(/&amp;/g, '&');
    if (/^www\./i.test(href)) {
      href = `https://${href}`;
    }
    if (!isAllowedExternalUrl(href)) {
      return rawMatch;
    }
    return `<span class="csv-link" data-href="${escapeHtml(href)}" title="Ctrl/Cmd+click to open">${matched}</span>${trailing}`;
  });
}

export function formatCellContent(text: string, linkify: boolean): string {
  const escaped = escapeHtml(text);
  return linkify ? linkifyUrls(escaped) : escaped;
}

/**
 * Store full cell text for preview/copy. Native `title` tooltips are not selectable,
 * so we expose data-full-text and let the webview show a copyable popover.
 * Used for multiline cells and long single-line values (truncated in the grid).
 */
export function getMultilineCellTitleAttr(text: string): string {
  if (!text) return '';
  const hasNewline = text.indexOf('\n') !== -1 || text.indexOf('\r') !== -1;
  const isLong = text.length >= 48;
  if (!hasNewline && !isLong) return '';
  // Encode newlines as entities so the attribute stays single-line in HTML.
  const encoded = escapeHtml(text)
    .replace(/\r\n/g, '&#10;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#10;');
  return ` data-full-text="${encoded}"`;
}

export function isDate(value: string): boolean {
  if (!value) return false;
  const v = value.trim();
  const isoDate = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  const isoSlash = /^\d{4}\/\d{2}\/\d{2}$/;
  if (!(isoDate.test(v) || isoSlash.test(v))) return false;
  return !isNaN(Date.parse(v));
}

export function isBooleanish(value: string): boolean {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return false;
  if (v === 'true' || v === 'false') return true;
  if (v === 't' || v === 'f') return true;
  if (v === 'yes' || v === 'no') return true;
  if (v === 'y' || v === 'n') return true;
  if (v === 'on' || v === 'off') return true;
  if (v === '1' || v === '0') return true;
  return false;
}

export function estimateColumnDataType(column: string[]): string {
  let allBoolean = true, allDate = true, allInteger = true, allFloat = true, allEmpty = true;
  for (const cell of column) {
    const items = cell.split(',').map(item => item.trim());
    for (const item of items) {
      if (item === '') continue;
      allEmpty = false;
      if (!isBooleanish(item)) allBoolean = false;
      if (!isDate(item)) allDate = false;
      const num = Number(item);
      if (!Number.isInteger(num)) allInteger = false;
      if (isNaN(num)) allFloat = false;
    }
  }
  if (allEmpty) return 'empty';
  if (allBoolean) return 'boolean';
  if (allDate) return 'date';
  if (allInteger) return 'integer';
  if (allFloat) return 'float';
  return 'string';
}

export function getColumnColor(type: string, isDark: boolean, columnIndex: number, palette: 'default' | 'cool' | 'warm' = 'default'): string {
  let hueRange = 0, isDefault = false;
  if (palette === 'cool') {
    switch (type) {
      case 'boolean': hueRange = 160; break;
      case 'date': hueRange = 210; break;
      case 'float': hueRange = isDark ? 195 : 205; break;
      case 'integer': hueRange = 130; break;
      case 'string': hueRange = 190; break;
      case 'empty': isDefault = true; break;
    }
  } else if (palette === 'warm') {
    switch (type) {
      case 'boolean': hueRange = 55; break;
      case 'date': hueRange = 28; break;
      case 'float': hueRange = isDark ? 18 : 24; break;
      case 'integer': hueRange = 42; break;
      case 'string': hueRange = 8; break;
      case 'empty': isDefault = true; break;
    }
  } else {
    switch (type) {
      case 'boolean': hueRange = 30; break;
      case 'date': hueRange = 210; break;
      case 'float': hueRange = isDark ? 60 : 270; break;
      case 'integer': hueRange = 120; break;
      case 'string': hueRange = 0; break;
      case 'empty': isDefault = true; break;
    }
  }
  if (isDefault) return isDark ? '#BBB' : '#444';
  const saturationOffset = ((columnIndex * 7) % 31) - 15;
  const saturation = saturationOffset + (isDark ? 60 : 80);
  const lightnessOffset = ((columnIndex * 13) % 31) - 15;
  const lightness = lightnessOffset + (isDark ? 70 : 30);
  const hueOffset = ((columnIndex * 17) % 31) - 15;
  const finalHue = (hueRange + hueOffset + 360) % 360;
  return hslToHex(finalHue, saturation, lightness);
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const r = Math.round(255 * f(0));
  const g = Math.round(255 * f(8));
  const b = Math.round(255 * f(4));
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}
