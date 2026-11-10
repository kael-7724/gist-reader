// An article's short Chinese name (at most 5 characters, e.g. 粉色噪音) used in lists and references.
export function cleanShortTitle(value: unknown) {
  if (typeof value !== "string") return "";
  return [...value.normalize("NFKC").replace(/[\s《》「」“”"'|·.,，。、]/g, "")].slice(0, 5).join("");
}
