export function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase("he-IL")
    .normalize("NFD")
    .replace(/[\u0591-\u05c7]/g, "")
    .replace(/[ךםןףץ]/g, (letter) => ({ ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" })[letter] ?? letter)
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const builtInShortcuts = new Set([
  "בב", "גבעז", "ים", "ספר", "אתא", "שמש", "חלקיה", "טלז", "ביתר",
  "גת", "פת", "שדה", "ראשון", "תא", "כותל",
].map(normalizeSearchText));

export function isBuiltInAbbreviation(shortcut: string): boolean {
  return builtInShortcuts.has(normalizeSearchText(shortcut));
}

export function expandCustomAbbreviations(
  value: string,
  abbreviations: readonly { shortcut: string; expansion: string }[],
): string {
  const expansions = new Map(abbreviations.map(({ shortcut, expansion }) =>
    [normalizeSearchText(shortcut), expansion]));
  // Replace complete words only; "רג" must not change "רגע".
  return value.replace(/[\p{L}\p{N}]+/gu, (word, offset: number) => {
    const expansion = expansions.get(normalizeSearchText(word));
    if (!expansion) return word;
    const expandedWords = expansion.trim().split(/\s+/u);
    if (expandedWords.length > 1 && normalizeSearchText(expandedWords[0]) === normalizeSearchText(word)) {
      const remainingWords = value.slice(offset + word.length).trimStart().split(/\s+/u);
      const completePlace = [word, ...remainingWords.slice(0, expandedWords.length - 1)].join(" ");
      if (normalizedSearchVariants(completePlace)[0] === normalizedSearchVariants(expansion)[0]) return word;
    }
    return expansion;
  });
}

function expandRouteAbbreviations(value: string) {
  const parts = value
    .replace(/טלז\s*סטון/gu, "קרית יערים")
    .split(/\s+/u);
  return parts
    .map((part, index) => {
      if (part === "בב") return "בני ברק";
      if (part === "ביתר" && !["עילית", "עלית"].includes(parts[index + 1] ?? "")) return "ביתר עילית";
      if (part === "עלית" && parts[index - 1] === "ביתר") return "עילית";
      if (part === "גבעז") return "גבעת זאב";
      if (part === "ים" && parts[index + 1] !== "המלח") return "ירושלים";
      if (part === "ספר" && parts[index - 1] !== "קרית") return "קרית ספר";
      if (part === "אתא" && parts[index - 1] !== "קרית") return "קרית אתא";
      if (part === "שמש" && parts[index - 1] !== "בית") return "בית שמש";
      if (part === "חלקיה" && parts[index - 1] !== "בית") return "בית חלקיה";
      if (part === "טלז") return "קרית יערים";
      if (part === "גת" && parts[index - 1] !== "קרית") return "קרית גת";
      if (part === "פת") return "פתח תקווה";
      if (part === "שדה") return 'נתב"ג';
      if (part === "ראשון" && parts[index + 1] !== "לציון") return "ראשון לציון";
      if (part === "תא") return "תל אביב";
      if (part === "כותל" && parts[index + 1] !== "המערבי") return "הכותל המערבי";
      return part;
    })
    .join(" ");
}

export function normalizedSearchVariants(value: string) {
  const expanded = expandRouteAbbreviations(value);
  const routeSegments = expanded.split("⇔").map((segment) => segment.trim()).filter(Boolean);
  const segments = routeSegments.map(normalizeSearchText);
  const variants = new Set([normalizeSearchText(expanded)]);
  if (segments.length > 1) variants.add([...segments].reverse().join(""));
  // A slash inside a catalog endpoint names alternate destinations, not an
  // extra stop. Match either full destination without guessing a different route.
  if (routeSegments.length === 2 && routeSegments.some((segment) => segment.includes("/"))) {
    const [origins, destinations] = routeSegments.map((segment) =>
      segment.split("/").map(normalizeSearchText).filter(Boolean));
    for (const origin of origins) {
      for (const destination of destinations) {
        variants.add(origin + destination);
        variants.add(destination + origin);
      }
    }
  }
  const words = expanded
    .replace(/⇔/gu, " ")
    .split(/\s+/u)
    .map((word) => normalizeSearchText(word))
    .filter(Boolean);
  if (words.length > 1) variants.add([...words].sort((left, right) => left.localeCompare(right, "he")).join(""));
  return [...variants];
}