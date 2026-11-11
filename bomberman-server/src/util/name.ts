const MAX_NAME_LENGTH = 16;

/** Keep display names short, printable, and safe for lobby/canvas rendering. */
export function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(cleaned).slice(0, MAX_NAME_LENGTH);
  return characters.join("").trim() || fallback;
}
