export function isValidFileKey(key: string): boolean {
  return /^[a-zA-Z0-9_-]{10,}$/.test(key);
}

export function isValidNodeId(id: string): boolean {
  return /^[\d]+-[\d]+$/.test(id) || /^[a-zA-Z0-9_-]+$/.test(id);
}

export function sanitizePath(p: string): string {
  return p.replace(/\.\./g, '').replace(/[<>"|?*]/g, '');
}
