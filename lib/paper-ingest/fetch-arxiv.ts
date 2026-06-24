/**
 * Fetch recent papers from arXiv q-fin.TR (Trading & Market Microstructure).
 * Uses the public Atom API — no auth required.
 * Sprint 081A.
 */

export interface RawPaper {
  title: string;
  source: "arxiv" | "ssrn";
  source_url: string;
  abstract: string;
}

const ARXIV_API =
  "https://export.arxiv.org/api/query" +
  "?search_query=cat:q-fin.TR" +
  "&sortBy=lastUpdatedDate" +
  "&sortOrder=descending" +
  "&max_results=20";

function parseEntry(entry: string): RawPaper | null {
  const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
  const abstract = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim();
  const sourceUrl =
    entry.match(/href="(https:\/\/arxiv\.org\/abs\/[^"]+)"/)?.[1] ??
    entry.match(/<id>(https:\/\/arxiv\.org\/abs\/[^<]+)<\/id>/)?.[1]?.trim();

  if (!title || !abstract || !sourceUrl) return null;
  return {
    title: decodeXmlEntities(title),
    source: "arxiv",
    source_url: sourceUrl,
    abstract: decodeXmlEntities(abstract),
  };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchArxivPapers(): Promise<RawPaper[]> {
  const res = await fetch(ARXIV_API, {
    headers: { "User-Agent": "Atlas/1.0 (https://atlas-broker.vercel.app)" },
  });
  if (!res.ok) throw new Error(`arXiv API ${res.status}: ${res.statusText}`);
  const xml = await res.text();

  const papers: RawPaper[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(xml)) !== null) {
    const paper = parseEntry(match[1]);
    if (paper) papers.push(paper);
  }
  return papers;
}
