import { TIER_SLUGS, isTierSlug, mediaUrl } from '../../shared/constants.ts';
import { listFilmRows } from '../database/films.ts';
import { loadSettings } from '../database/settings.ts';
import { publicOrigin, type AppEnv } from '../env.ts';
import { logError } from '../lib/log.ts';

const DEFAULT_OG_IMAGE = '/og-image.jpg';
const DESCRIPTION_LIMIT = 300;

const PERMISSIONS_POLICY =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';

function isLocalDev(url: URL): boolean {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function contentSecurityPolicy(url: URL): string {
  // Dev-сервер Vite вставляет встроенный скрипт (React Refresh) и держит WebSocket для HMR.
  // Послабление действует только на http://localhost; в бою политика строгая.
  const dev = isLocalDev(url);
  return [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self' https://*.r2.cloudflarestorage.com${dev ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function shorten(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > DESCRIPTION_LIMIT ? `${flat.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…` : flat;
}

interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  ogType: string;
  ogImage: string;
  siteName: string;
  noindex: boolean;
  faviconUrl: string | null;
}

async function resolveMeta(env: AppEnv, request: Request, url: URL): Promise<PageMeta> {
  const origin = publicOrigin(env, request);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/';
  const { settings, imageKeys } = await loadSettings(env.DB);
  const meta: PageMeta = {
    title: settings.metaTitle,
    description: shorten(settings.metaDescription),
    canonical: origin + (path === '/' ? '/' : path),
    ogType: 'website',
    ogImage: origin + (mediaUrl(imageKeys.og) ?? DEFAULT_OG_IMAGE),
    siteName: settings.studioName,
    noindex: false,
    faviconUrl: mediaUrl(imageKeys.favicon),
  };

  if (path === '/admin' || path.startsWith('/admin/')) {
    return { ...meta, title: `Админка — ${settings.studioName}`, noindex: true };
  }
  if (path === '/about') {
    return {
      ...meta,
      title: `${settings.aboutTitle || 'О студии'} — ${settings.studioName}`,
      description: shorten(settings.aboutText) || meta.description,
    };
  }
  if (path.startsWith('/watch/')) {
    const slug = path.slice('/watch/'.length);
    const film = isTierSlug(slug)
      ? (await listFilmRows(env.DB)).find((item) => item.slug === slug)
      : undefined;
    if (!film) return { ...meta, noindex: true };
    return {
      ...meta,
      title: `${film.title} — ${settings.studioName}`,
      description: shorten(film.long_description || film.short_description) || meta.description,
      ogType: 'video.other',
      ogImage: film.poster_key ? origin + (mediaUrl(film.poster_key) ?? DEFAULT_OG_IMAGE) : meta.ogImage,
    };
  }
  return path === '/' ? meta : { ...meta, noindex: true };
}

/** Все значения экранируются: тексты приходят из настроек, которые редактирует администратор. */
function headTags(meta: PageMeta): string {
  const tag = (attribute: 'name' | 'property', key: string, content: string): string =>
    `<meta ${attribute}="${key}" content="${escapeHtml(content)}">`;
  const tags = [tag('name', 'description', meta.description)];
  if (meta.noindex) {
    tags.push(tag('name', 'robots', 'noindex, nofollow'));
    return tags.join('');
  }
  tags.push(
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}">`,
    tag('property', 'og:title', meta.title),
    tag('property', 'og:description', meta.description),
    tag('property', 'og:type', meta.ogType),
    tag('property', 'og:url', meta.canonical),
    tag('property', 'og:image', meta.ogImage),
    tag('property', 'og:site_name', meta.siteName),
    tag('property', 'og:locale', 'ru_RU'),
    tag('name', 'twitter:card', 'summary_large_image'),
    tag('name', 'twitter:title', meta.title),
    tag('name', 'twitter:description', meta.description),
    tag('name', 'twitter:image', meta.ogImage),
  );
  return tags.join('');
}

function applySecurityHeaders(headers: Headers, url: URL, noindex: boolean): void {
  headers.set('Content-Security-Policy', contentSecurityPolicy(url));
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', PERMISSIONS_POLICY);
  if (url.protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (noindex) headers.set('X-Robots-Tag', 'noindex');
}

/** Отдаёт файл сборки; в HTML подставляет метаданные страницы и добавляет заголовки безопасности. */
export async function serveAsset(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  // Условные заголовки убираются: HTML зависит от настроек, а ETag файла сборки об этом не знает.
  const assetRequest = new Request(request);
  assetRequest.headers.delete('If-None-Match');
  assetRequest.headers.delete('If-Modified-Since');
  const response = await env.ASSETS.fetch(assetRequest);
  if (!(response.headers.get('Content-Type') ?? '').includes('text/html')) return response;

  let meta: Awaited<ReturnType<typeof resolveMeta>>;
  try {
    meta = await resolveMeta(env, request, url);
  } catch (err) {
    // База недоступна: страница всё равно открывается — с метаданными из сборки и теми же заголовками.
    logError('Не удалось прочитать настройки для HTML', err);
    const fallbackHeaders = new Headers(response.headers);
    fallbackHeaders.set('Cache-Control', 'no-cache');
    applySecurityHeaders(fallbackHeaders, url, url.pathname.startsWith('/admin'));
    return new Response(response.body, { status: response.status, headers: fallbackHeaders });
  }
  const headers = new Headers(response.headers);
  headers.delete('ETag');
  headers.delete('Last-Modified');
  headers.delete('Content-Length');
  headers.set('Cache-Control', 'no-cache');
  applySecurityHeaders(headers, url, meta.noindex);

  const remove = { element: (element: Element): void => void element.remove() };
  let rewriter = new HTMLRewriter()
    .on('title', { element: (element) => void element.setInnerContent(meta.title) })
    .on('meta[name="description"]', remove)
    .on('meta[name="robots"]', remove)
    .on('meta[property^="og:"]', remove)
    .on('meta[name^="twitter:"]', remove)
    .on('link[rel="canonical"]', remove)
    .on('head', { element: (element) => void element.append(headTags(meta), { html: true }) });
  if (meta.faviconUrl) {
    const faviconUrl = meta.faviconUrl;
    rewriter = rewriter.on('link[rel="icon"]', {
      element: (element) => {
        element.setAttribute('href', faviconUrl);
        element.removeAttribute('type');
      },
    });
  }
  return rewriter.transform(new Response(response.body, { status: response.status, headers }));
}

export function robotsTxt(env: AppEnv, request: Request): Response {
  const origin = publicOrigin(env, request);
  const body = `User-agent: *\nDisallow: /admin\nDisallow: /api\n\nSitemap: ${origin}/sitemap.xml\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

export function sitemapXml(env: AppEnv, request: Request): Response {
  const origin = publicOrigin(env, request);
  const paths = ['/', ...TIER_SLUGS.map((slug) => `/watch/${slug}`)];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths.map((path) => `  <url><loc>${escapeHtml(origin + path)}</loc></url>\n`).join('') +
    '</urlset>\n';
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
