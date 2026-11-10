import lemmatizer from "wink-lemmatizer";

export function normalizeEnglishWord(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^[^a-z]+|[^a-z']+$/g, "");
}

export function englishLemmaCandidates(value: string) {
  const word = normalizeEnglishWord(value);
  if (!word) return [];
  const lemmas = [
    lemmatizer.verb(word),
    lemmatizer.noun(word),
    lemmatizer.adjective(word),
  ].map(normalizeEnglishWord).filter(Boolean);
  return [...new Set([...lemmas.filter((candidate) => candidate !== word), word])];
}

export function lemmatizeEnglishWord(value: string) {
  return englishLemmaCandidates(value)[0] || normalizeEnglishWord(value);
}
