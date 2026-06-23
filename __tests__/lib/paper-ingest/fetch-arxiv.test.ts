/**
 * Sprint 081A — arXiv paper fetcher unit tests.
 *
 * Tests the Atom XML parser without making real HTTP calls.
 */

// fetchArxivPapers is tested via its internal parseEntry logic by mocking fetch.
import { fetchArxivPapers } from "@/lib/paper-ingest/fetch-arxiv";

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://arxiv.org/abs/2406.12345v1</id>
    <title>Momentum Strategies in High-Frequency Trading</title>
    <summary>
      We examine momentum effects in intraday equity markets using a novel
      microstructure dataset. Our results suggest significant short-term predictability.
    </summary>
    <link rel="alternate" type="text/html" href="https://arxiv.org/abs/2406.12345"/>
    <link rel="related" type="application/pdf" href="https://arxiv.org/pdf/2406.12345"/>
  </entry>
  <entry>
    <id>https://arxiv.org/abs/2406.67890v2</id>
    <title>Mean Reversion &amp; Keltner Channel Strategies</title>
    <summary>We study mean-reversion strategies using Keltner Channels.</summary>
    <link rel="alternate" type="text/html" href="https://arxiv.org/abs/2406.67890"/>
  </entry>
  <entry>
    <id>https://arxiv.org/abs/incomplete</id>
    <title>Paper With No Abstract</title>
  </entry>
</feed>`;

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: async () => SAMPLE_ATOM,
  } as unknown as Response);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("fetchArxivPapers", () => {
  it("returns one paper per valid entry", async () => {
    const papers = await fetchArxivPapers();
    // 3 entries but 1 has no abstract — expect 2 valid papers
    expect(papers).toHaveLength(2);
  });

  it("parses title and abstract correctly", async () => {
    const papers = await fetchArxivPapers();
    expect(papers[0].title).toBe("Momentum Strategies in High-Frequency Trading");
    expect(papers[0].abstract).toContain("momentum effects");
  });

  it("uses the html link as source_url when present", async () => {
    const papers = await fetchArxivPapers();
    expect(papers[0].source_url).toBe("https://arxiv.org/abs/2406.12345");
  });

  it("decodes XML entities in titles", async () => {
    const papers = await fetchArxivPapers();
    expect(papers[1].title).toBe("Mean Reversion & Keltner Channel Strategies");
  });

  it("sets source to 'arxiv'", async () => {
    const papers = await fetchArxivPapers();
    expect(papers.every((p) => p.source === "arxiv")).toBe(true);
  });

  it("normalises multi-line whitespace in abstract", async () => {
    const papers = await fetchArxivPapers();
    // No internal newlines or double-spaces
    expect(papers[0].abstract).not.toMatch(/\n/);
    expect(papers[0].abstract).not.toMatch(/  /);
  });

  it("throws when arXiv API returns non-OK status", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    } as unknown as Response);

    await expect(fetchArxivPapers()).rejects.toThrow("arXiv API 503");
  });
});
