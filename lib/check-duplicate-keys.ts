/**
 * Scans raw JSON text for duplicate keys within the same object literal.
 * `JSON.parse` silently keeps the LAST duplicate and gives no signal one
 * existed — this walks the raw text directly so messages/en.json and
 * zh-CN.json (translated by hand, no schema) can be caught by a test instead
 * of one entry quietly shadowing another (as `errors.recomputeBusy` did).
 * Returns each duplicated key name, once per extra occurrence.
 */
export function findDuplicateKeys(json: string): string[] {
  const duplicates: string[] = [];
  const stack: Set<string>[] = [];
  let i = 0;
  const n = json.length;

  function readString(): string {
    let out = "";
    i++; // opening quote
    while (i < n && json[i] !== '"') {
      if (json[i] === "\\") {
        out += json[i] + json[i + 1];
        i += 2;
      } else {
        out += json[i];
        i++;
      }
    }
    i++; // closing quote
    return out;
  }

  while (i < n) {
    const c = json[i];
    if (c === "{") {
      stack.push(new Set());
      i++;
    } else if (c === "}") {
      stack.pop();
      i++;
    } else if (c === '"') {
      const str = readString();
      while (i < n && /\s/.test(json[i])) i++;
      if (json[i] === ":" && stack.length > 0) {
        const keys = stack[stack.length - 1];
        if (keys.has(str)) duplicates.push(str);
        else keys.add(str);
        i++; // colon
      }
    } else {
      i++;
    }
  }
  return duplicates;
}
