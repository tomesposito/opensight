// Public site files are deliberately bounded. Operator inputs never become assets.
export const marketingFiles = Object.freeze([
  'index.html', 'styles.css', 'app.js', 'robots.txt', 'sitemap.xml', 'demo/index.html',
  'pricing/index.html', 'alternatives/quicksight/index.html', 'alternatives/tableau/index.html',
  'alternatives/power-bi/index.html', 'vs/metabase/index.html', 'vs/superset/index.html',
  'docs/index.html', 'docs/docs.css', 'docs/connectors/index.html', 'docs/embedding/index.html',
  'docs/embedding-sessions/index.html', 'docs/getting-started/index.html',
  'docs/migrating-from-quicksight/index.html', 'docs/open-economics/index.html', 'docs/permissions/index.html',
  'signup/index.html', 'signup/signup.js',
  'assets/blaze.png', 'assets/data-prep.png', 'assets/data-sources.png',
  'assets/embed-preview.png', 'assets/favicon.svg', 'assets/apple-touch-icon.png', 'assets/hero-poster.jpg',
  'assets/hero.mp4', 'assets/hero.webm', 'assets/opensight-tour.gif', 'assets/og-image.jpg',
].map(name => 'marketing/' + name));
export function requireMarketing(files, required = false) {
  const names = Object.keys(files).filter(name => name.startsWith('marketing/'));
  if ((required || names.length) && (names.length !== marketingFiles.length
    || marketingFiles.some(name => !/^[a-f0-9]{64}$/.test(files[name])))) throw Error('MARKETING_BUNDLE_REQUIRED');
  return files;
}
export function frontendMetadata(name) {
  const type = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
    json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    txt: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8',
    gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', ico: 'image/x-icon', woff2: 'font/woff2' };
  return { ContentType: type[name.split('.').at(-1)] ?? 'application/octet-stream',
    CacheControl: name.startsWith('assets/') ? 'public,max-age=31536000,immutable'
      : name.startsWith('marketing/assets/') ? 'public,max-age=300' : 'no-store' };
}
