import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const TEMPLATE_FILE = join(ROOT, 'src', 'template.html');
const OUTPUT_DIR = join(ROOT, 'dist');
const OUTPUT_FILE = join(OUTPUT_DIR, 'index.html');

const files = {
  content: { src: join(ROOT, 'data', 'content.json'), example: join(ROOT, 'data', 'content.example.json') },
  writing: { src: join(ROOT, 'data', 'writing.json'), example: join(ROOT, 'data', 'writing.example.json') },
  work:    { src: join(ROOT, 'data', 'work.json'),    example: join(ROOT, 'data', 'work.example.json') },
};

function readJSON(path, examplePath) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`${path} not found, copying from ${examplePath}`);
      copyFileSync(examplePath, path);
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
    console.error(`Failed to parse ${path}: ${err.message}`);
    process.exit(1);
  }
}

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

async function fetchAndSaveWriting(rssUrl, outPath) {
  try {
    const res = await fetch(rssUrl, {
      headers: { 'User-Agent': 'lean-rss-feed-website/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseRSS(xml).filter(i => i.title && i.url);

    if (items.length === 0) throw new Error('no items in feed');

    const [first, ...rest] = items;
    const writing = {
      latest: {
        eyebrow: 'Latest',
        date: first.date,
        title: first.title,
        excerpt: first.excerpt || 'Read the full post.',
        readTime: '',
        url: first.url,
      },
      morePosts: rest.slice(0, 4).map(p => ({
        title: p.title,
        date: p.date,
        url: p.url,
      })),
    };

    writeFileSync(outPath, JSON.stringify(writing, null, 2) + '\n', 'utf-8');
    console.log(`Wrote ${outPath} from RSS`);
    return writing;
  } catch (err) {
    console.warn(`RSS fetch failed (${err.message})`);
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
  const content = readJSON(files.content.src, files.content.example);
  const work = readJSON(files.work.src, files.work.example);
  const writing = await fetchAndSaveWriting(content.rss.url, files.writing.src)
    || readJSON(files.writing.src, files.writing.example);

  const data = { ...content, work, ...writing };
  build(data);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
