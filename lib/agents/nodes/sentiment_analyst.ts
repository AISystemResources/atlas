/**
 * Sentiment Analyst node — news, social media, market mood.
 *
 * Mirrors backend/agents/analysts/sentiment.py exactly.
 */

import type { AtlasState, SentimentOutput } from "../state";
import { SentimentOutputSchema, validateStateSlice, llmConfigFromState } from "../state";
import { getLlm } from "../llm";
import { getPhilosophyPrefix } from "../philosophies";
import type { NewsItem } from "@/lib/market";

const MAX_ARTICLES = 15;

interface ArticleMetadata {
  title: string;
  date: string;
  url?: string;
}

function extractArticleMetadata(news: NewsItem[]): ArticleMetadata[] {
  const articles: ArticleMetadata[] = [];
  for (const item of news.slice(0, MAX_ARTICLES)) {
    if (!item.title) continue;
    // Truncate to date portion if it includes time
    const dateStr = item.published ? item.published.slice(0, 10) : "";
    articles.push({ title: item.title, date: dateStr });
  }
  return articles;
}

export async function sentimentAnalystNode(
  state: AtlasState,
): Promise<Partial<AtlasState>> {
  const startMs = Date.now();
  const { ticker, news = [], philosophy_mode } = state;

  const headlines = (news as NewsItem[])
    .filter((n) => n.title)
    .map((n) => n.title);
  const newsArticles = extractArticleMetadata(news as NewsItem[]);
  const philosophyPrefix = getPhilosophyPrefix(philosophy_mode);

  const prompt = `${philosophyPrefix}You are a sentiment analyst for a swing trading system. Analyse recent news for ${ticker} and return a JSON object.

Recent news headlines:
${JSON.stringify(headlines, null, 2)}

Return ONLY valid JSON with this exact structure:
{
  "signal": "BUY" or "SELL" or "HOLD",
  "sentiment_score": <float between -1.0 (very negative) and 1.0 (very positive)>,
  "reasoning": "2-3 sentence sentiment analysis",
  "dominant_themes": ["theme1", "theme2"]
}`;

  const llmConfig = llmConfigFromState(state);
  let text = "";
  try {
    const llm = await getLlm("quick", llmConfig);
    const response = await llm.invoke(prompt);
    text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  } catch (err) {
    console.error("[sentiment] LLM error:", err instanceof Error ? err.message : String(err));
  }

  let parsed: Record<string, unknown>;
  try {
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const modelId = llmConfig?.model ?? "llama-3.1-8b-instant";

  const result = validateStateSlice<SentimentOutput>(
    SentimentOutputSchema,
    {
      signal: parsed["signal"] ?? "HOLD",
      sentiment_score: parsed["sentiment_score"] ?? 0.0,
      dominant_themes: Array.isArray(parsed["dominant_themes"])
        ? (parsed["dominant_themes"] as string[])
        : [],
      sources: ["news"],
      headline_count: headlines.length,
      reasoning: parsed["reasoning"] ?? "",
      news_articles: newsArticles,
      model: modelId,
      latency_ms: Date.now() - startMs,
    },
    "sentiment_analyst",
  );

  return {
    analyst_outputs: { sentiment: result },
  };
}
