// Display names for common English-language publications, keyed by domain.
export const KNOWN: [string, string][] = [
  ["theguardian.com", "The Guardian"], ["economist.com", "The Economist"], ["theatlantic.com", "The Atlantic"],
  ["scientificamerican.com", "Scientific American"], ["theconversation.com", "The Conversation"], ["nytimes.com", "The New York Times"],
  ["washingtonpost.com", "The Washington Post"], ["bbc.com", "BBC"], ["bbc.co.uk", "BBC"], ["ft.com", "Financial Times"],
  ["newyorker.com", "The New Yorker"], ["wired.com", "WIRED"], ["nature.com", "Nature"], ["science.org", "Science"],
  ["aeon.co", "Aeon"], ["nationalgeographic.com", "National Geographic"], ["sciencefocus.com", "BBC Science Focus"], ["smithsonianmag.com", "Smithsonian Magazine"], ["newscientist.com", "New Scientist"], ["apnews.com", "AP News"], ["cnn.com", "CNN"], ["latimes.com", "Los Angeles Times"], ["bloomberg.com", "Bloomberg"], ["wsj.com", "The Wall Street Journal"], ["vox.com", "Vox"], ["time.com", "TIME"], ["nasa.gov", "NASA"], ["npr.org", "NPR"], ["reuters.com", "Reuters"],
];

export function publisherFor(hostname: string) {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return KNOWN.find(([domain]) => host === domain || host.endsWith("." + domain))?.[1] || "";
}
