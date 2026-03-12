export default async function attach(input, _context = {}) {
  let payload = input;

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed) {
      try {
        payload = JSON.parse(trimmed);
      } catch {
        payload = { value: trimmed };
      }
    }
  }

  if (!payload || typeof payload !== "object") {
    return { value: payload };
  }

  return payload;
}
