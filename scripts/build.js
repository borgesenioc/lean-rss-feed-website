import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const TEMPLATE_FILE = join(ROOT, 'src', 'template.html');
const DATA_FILE = join(ROOT, 'data', 'content.json');
const EXAMPLE_FILE = join(ROOT, 'data', 'content.example.json');
const OUTPUT_DIR = join(ROOT, 'dist');
const OUTPUT_FILE = join(OUTPUT_DIR, 'index.html');

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

// Parses RSS XML. Currently handles Substack format.
// If your feed uses different element paths, add matchers below.
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const content = match[1];
    const title = content.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      || content.match(/<title>(.*?)<\/title>/)?.[1]
      || '';
    const link = content.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const pubDate = content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    const description = content.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1]
      || content.match(/<description>(.*?)<\/description>/)?.[1]
      || '';

    const parsed = parseDate(pubDate);
    items.push({
      title: title.replace(/<\/?[^>]+(>|$)/g, '').trim(),
      url: link.trim(),
      date: parsed ? formatDate(parsed) : '',
      isoDate: parsed ? parsed.toISOString() : '',
      excerpt: description.replace(/<\/?[^>]+(>|$)/g, '').trim().slice(0, 200),
    });
  }
  return items;
}

async function fetchPosts(rssUrl) {
  try {
    const res = await fetch(rssUrl, {
      headers: { 'User-Agent': 'lean-rss-feed-website/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseRSS(xml);
    return items.filter(i => i.title && i.url);
  } catch (err) {
    console.warn(`RSS fetch failed (${err.message}), using fallback data`);
    return null;
  }
}

function build(data) {
  const source = readFileSync(TEMPLATE_FILE, 'utf-8');
  const template = Handlebars.compile(source);
  const html = template(data);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, html, 'utf-8');
  console.log(`Built ${OUTPUT_FILE}`);
}

async function main() {
  let staticData;
  try {
    staticData = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('data/content.json not found, copying from content.example.json');
      copyFileSync(EXAMPLE_FILE, DATA_FILE);
      staticData = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
    } else {
      console.error(`Failed to parse data/content.json: ${err.message}`);
      process.exit(1);
    }
  }
  const { rss } = staticData;
  const posts = await fetchPosts(rss.url);

  let latest, morePosts;

  if (posts && posts.length > 0) {
    const [first, ...rest] = posts;
    latest = {
      eyebrow: 'Latest',
      date: first.date,
      title: first.title,
      excerpt: first.excerpt || 'Read the full post.',
      readTime: '',
      url: first.url,
    };
    morePosts = rest.slice(0, 4).map(p => ({
      title: p.title,
      date: p.date,
      url: p.url,
    }));
  } else {
    latest = {
      eyebrow: 'Latest',
      date: rss.fallbackLatest.date,
      title: rss.fallbackLatest.title,
      excerpt: rss.fallbackLatest.excerpt,
      readTime: rss.fallbackLatest.readTime || '',
      url: rss.fallbackLatest.url,
    };
    morePosts = rss.fallbackPosts;
  }

  const data = { ...staticData, latest, morePosts };
  build(data);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
