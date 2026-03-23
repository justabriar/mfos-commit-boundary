import { createHash } from 'node:crypto';

function canonicalizeValue(value: unknown): string {
  if (value === null) return 'null';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Non-finite numbers are not allowed in canonical payloads');
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeValue).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeValue(record[key])}`);
    return `{${pairs.join(',')}}`;
  }

  throw new Error(`Unsupported payload value type: ${typeof value}`);
}

export function canonicalizeJson(value: unknown): string {
  return canonicalizeValue(value);
}

export function sha256Hex(value: unknown): string {
  return createHash('sha256').update(canonicalizeJson(value)).digest('hex');
}
