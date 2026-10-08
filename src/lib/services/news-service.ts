import { ObjectId } from 'mongodb';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tryGetDb, COLLECTIONS } from '@/lib/db/mongo';

/**
 * Financial news, cached in MongoDB.
 *
 * Source: the Reserve Bank of India press-release RSS feed — official, free,
 * needs no API key, and it is where repo rate decisions are announced, which
 * is what the loan-impact feature needs. Articles are cached in Mongo because
 * a feed item is a semi-structured document (optional rate fields, free tags)
 * with no relational shape worth imposing.
 *
 * Refresh is lazy: a read triggers a fetch when the cache is older than
 * CACHE_TTL. A cron (system cron, Vercel Cron, GitHub Actions) can call
 * POST /api/news/refresh instead for a fixed schedule.
 *
 * When neither Mongo nor the feed is reachable, a bundled sample set is
 * served. Every sample item is flagged isSample and says "illustrative" in its
 * headline: sample data must never be mistakable for real news.
 */

export const RBI_FEED = 'https://www.rbi.org.in/pressreleases_rss.xml';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type NewsCategory = 'rates' | 'inflation' | 'banking' | 'markets' | 'policy' | 'housing';

export interface Article {
  id: string;
  headline: string;
  source: string;
  category: NewsCategory;
  tags: string[];
  body: string;
  url: string | null;
  publishedAt: string;
  relatedRateType: 'repo' | 'mclr' | 'none';
  rateChangeBps: number | null;
  isSample: boolean;
}

interface ArticleDoc extends Omit<Article, 'id' | 'publishedAt'> {
  _id?: ObjectId;
  publishedAt: Date;
  fetchedAt: Date;
}

let samples: Article[] | null = null;
function sampleArticles(): Article[] {
  samples ??= (JSON.parse(readFileSync(join(process.cwd(), 'db', 'seed-data', 'news-sample.json'), 'utf8')) as
    Omit<Article, 'source' | 'url' | 'isSample'>[]).map((a) => ({
      ...a, source: 'Sample data (illustrative)', url: null, isSample: true,
    }));
  return samples;
}

// -------------------------------------------------------- classification

/** Keyword classification of a feed item. Order matters: first match wins. */
export function classify(title: string, body = ''): { category: NewsCategory; tags: string[] } {
  const t = `${title} ${body}`.toLowerCase();
  const tags = ['repo', 'mclr', 'inflation', 'cpi', 'gold', 'fd', 'deposit', 'home loan', 'mpc', 'liquidity', 'nbfc']
    .filter((k) => t.includes(k));
  const category: NewsCategory =
    /repo|monetary policy|policy rate|mpc|basis points|bps/.test(t) ? 'rates'
    : /inflation|cpi|wpi|price/.test(t) ? 'inflation'
    : /housing|real estate|home loan/.test(t) ? 'housing'
    : /gold|equity|market|bond|yield/.test(t) ? 'markets'
    : /small savings|ppf|government|ministry|scheme/.test(t) ? 'policy'
    : 'banking';
  return { category, tags };
}

/**
 * Pulls a rate move out of a headline: "repo rate ... by 25 basis points",
 * with direction from the verb. Returns null when there is no clear change.
 */
export function detectRateChange(text: string): { type: 'repo' | 'mclr'; bps: number } | null {
  const t = text.toLowerCase();
  const type = t.includes('repo') ? 'repo' : t.includes('mclr') ? 'mclr' : null;
  if (!type) return null;
  const m = t.match(/(\d{1,3})\s*(?:basis points|bps)/);
  if (!m) return null;
  const sign = /(cut|reduc|lower|decreas)/.test(t) ? -1 : /(hike|rais|increas)/.test(t) ? 1 : 0;
  return sign === 0 ? null : { type, bps: sign * Number(m[1]) };
}

// ---------------------------------------------------------------- fetch

const unescape = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/** Minimal RSS 2.0 reader — the feed is simple and stable enough to need no XML library. */
export function parseRss(xml: string) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const tag = (block: string, name: string) =>
    unescape(block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '');
  return items.map((block) => ({
    title: tag(block, 'title'),
    link: tag(block, 'link'),
    description: tag(block, 'description'),
    pubDate: tag(block, 'pubDate'),
  })).filter((i) => i.title && i.link);
}

export async function refreshFromFeed(): Promise<{ fetched: number; upserted: number }> {
  const db = await tryGetDb();
  if (!db) throw new Error('News caching needs MongoDB.');

  const res = await fetch(RBI_FEED, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Feed returned ${res.status}`);
  const items = parseRss(await res.text());

  const col = db.collection<ArticleDoc>(COLLECTIONS.newsArticles);
  let upserted = 0;
  for (const it of items.slice(0, 50)) {
    const { category, tags } = classify(it.title, it.description);
    const rate = detectRateChange(`${it.title} ${it.description}`);
    const published = new Date(it.pubDate);
    // Keyed on the article URL, so re-fetching never duplicates.
    const r = await col.updateOne(
      { url: it.link },
      { $set: {
          headline: it.title, source: 'Reserve Bank of India', category, tags,
          body: it.description.slice(0, 2000), url: it.link,
          publishedAt: Number.isNaN(published.getTime()) ? new Date() : published,
          relatedRateType: rate?.type ?? 'none', rateChangeBps: rate?.bps ?? null,
          isSample: false, fetchedAt: new Date(),
        } },
      { upsert: true },
    );
    upserted += r.upsertedCount + r.modifiedCount;
  }
  return { fetched: items.length, upserted };
}

// ----------------------------------------------------------------- read

function toArticle(d: ArticleDoc): Article {
  return {
    id: d._id!.toHexString(), headline: d.headline, source: d.source, category: d.category,
    tags: d.tags, body: d.body, url: d.url, publishedAt: d.publishedAt.toISOString(),
    relatedRateType: d.relatedRateType, rateChangeBps: d.rateChangeBps, isSample: d.isSample,
  };
}

export interface NewsFeed {
  articles: Article[];
  categories: { category: string; count: number }[];
  origin: 'mongo-cache' | 'sample';
  note: string | null;
}

export async function getFeed(category?: string): Promise<NewsFeed> {
  const db = await tryGetDb();

  if (db) {
    const col = db.collection<ArticleDoc>(COLLECTIONS.newsArticles);
    const newest = await col.find({ isSample: false }).sort({ fetchedAt: -1 }).limit(1).next();
    if (!newest || Date.now() - newest.fetchedAt.getTime() > CACHE_TTL_MS) {
      await refreshFromFeed().catch(() => {});   // stale is better than empty
    }
    const filter = category && category !== 'all' ? { category: category as NewsCategory } : {};
    const docs = await col.find(filter).sort({ publishedAt: -1 }).limit(60).toArray();
    if (docs.length > 0) {
      // Aggregation pipeline: article count per category, for the filter chips.
      const categories = await col.aggregate<{ category: string; count: number }>([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $project: { _id: 0, category: '$_id', count: 1 } },
        { $sort: { count: -1 } },
      ]).toArray();
      return { articles: docs.map(toArticle), categories, origin: 'mongo-cache', note: null };
    }
  }

  // Fallback: the bundled sample set, with the same shape and the same filter.
  const all = sampleArticles();
  const counts = new Map<string, number>();
  for (const a of all) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
  return {
    articles: (category && category !== 'all' ? all.filter((a) => a.category === category) : all)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    categories: [...counts].map(([c, n]) => ({ category: c, count: n })).sort((a, b) => b.count - a.count),
    origin: 'sample',
    note: db
      ? 'The RBI feed could not be reached, so illustrative sample articles are shown.'
      : 'MongoDB is not configured, so illustrative sample articles are shown instead of the cached RBI feed.',
  };
}

export async function getArticle(id: string): Promise<Article | null> {
  const sample = sampleArticles().find((a) => a.id === id);
  if (sample) return sample;
  if (!ObjectId.isValid(id)) return null;
  const db = await tryGetDb();
  if (!db) return null;
  const doc = await db.collection<ArticleDoc>(COLLECTIONS.newsArticles).findOne({ _id: new ObjectId(id) });
  return doc ? toArticle(doc) : null;
}
