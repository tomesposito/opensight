// CloudFront Functions viewer-request. Rewrites also isolate the cache key.
var APP_HOST = __OPENSIGHT_APP_HOST__;
var MARKETING_HOST = __OPENSIGHT_MARKETING_HOST__;
function handler(event) {
  var r = event.request, h = r.headers && r.headers.host;
  var denied = { statusCode: 404, statusDescription: 'Not Found', headers: { 'cache-control': { value: 'no-store' } } };
  if (!h || h.multiValue || (h.value !== APP_HOST && h.value !== MARKETING_HOST)
      || (r.method !== 'GET' && r.method !== 'HEAD')) return denied;
  var uri = r.uri;
  // No decoded separators/dot paths or alternate forms of private prefixes.
  if (typeof uri !== 'string' || !/^\/[A-Za-z0-9_./-]*$/.test(uri) || uri.indexOf('//') !== -1
      || uri.split('/').some(function (p) { return p === '.' || p === '..'; })) return denied;
  if (h.value === MARKETING_HOST) {
    if (uri === '/demo') return { statusCode: 308, statusDescription: 'Permanent Redirect',
      headers: { location: { value: '/demo/' }, 'cache-control': { value: 'no-store' } } };
    if (uri === '/' || uri === '/index.html') r.uri = '/marketing/index.html';
    else if (uri === '/robots.txt') r.uri = '/marketing/robots.txt';
    else if (uri === '/sitemap.xml') r.uri = '/marketing/sitemap.xml';
    else if (uri === '/demo/' || uri === '/demo/index.html') r.uri = '/marketing/demo/index.html';
    else if (/^\/(?:styles\.css|app\.js|assets\/[A-Za-z0-9_-]+\.(?:png|jpg|svg|mp4|webm|gif))$/.test(uri)) r.uri = '/marketing' + uri;
    else return denied;
  } else {
    if (uri === '/') r.uri = '/index.html';
    else if (!/^\/(?:index\.html|opensight-embed(?:-preview|-session)?\.html|assets\/[A-Za-z0-9_.-]+)$/.test(uri)) return denied;
  }
  return r;
}
