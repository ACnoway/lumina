export function normalizePhone(value: string): string {
  const raw = value.trim().replace(/[\s()-]/g, '');
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('0086')) return `+${raw.slice(2)}`;
  if (raw.startsWith('86') && raw.length === 13) return `+${raw}`;
  if (/^1\d{10}$/.test(raw)) return `+86${raw}`;
  return raw;
}

export function isValidPhone(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhone(value));
}

export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizePhone(value);
  const national = normalized.startsWith('+86') ? normalized.slice(3) : normalized;
  if (national.length >= 7) {
    return `${national.slice(0, 3)}****${national.slice(-4)}`;
  }
  return `${normalized.slice(0, 2)}****${normalized.slice(-2)}`;
}

export function maskSecret(value: string | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
