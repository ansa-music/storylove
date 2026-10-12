import { Hono } from 'hono';

import type { AppBindings } from './env.ts';
import { ApiError, errorResponse, notFound } from './lib/errors.ts';
import { logError } from './lib/log.ts';
import { noStore, requireAdmin, requireCsrf } from './middleware/auth.ts';
import { filmRoutes } from './routes/admin-films.ts';
import { settingsRoutes } from './routes/admin-settings.ts';
import { dashboardRoutes, storageRoutes } from './routes/admin-storage.ts';
import { uploadRoutes } from './routes/admin-uploads.ts';
import { videoRoutes } from './routes/admin-videos.ts';
import { accountRoutes, authRoutes } from './routes/auth.ts';
import { robotsTxt, serveAsset, sitemapXml } from './routes/html.ts';
import { serveMedia } from './routes/media.ts';
import { publicRoutes } from './routes/public.ts';

const app = new Hono<AppBindings>();

app.onError((error, c) => {
  if (error instanceof ApiError) return errorResponse(error);
  // В журнал — только имя и текст ошибки; клиенту — без подробностей и стека.
  logError(`Необработанная ошибка ${c.req.method} ${c.req.path}`, error);
  return errorResponse(new ApiError(500, 'internal_error', 'Внутренняя ошибка сервера. Попробуйте позже.'));
});

// Незашифрованный http — только на localhost; на боевом адресе страницы переводятся на https,
// а API по http не обслуживается вовсе (пароль не должен уйти открытым текстом).
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const local =
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  if (url.protocol !== 'http:' || local) return next();
  if (url.pathname.startsWith('/api/')) {
    throw new ApiError(400, 'bad_request', 'Используйте защищённое соединение (https).');
  }
  url.protocol = 'https:';
  return c.redirect(url.toString(), 301);
});

app.use('/api/auth/*', noStore);
app.use('/api/admin/*', noStore);
// Сессия обязательна на каждом маршруте админки, включая GET; изменяющие запросы — ещё и CSRF.
app.use('/api/admin/*', requireAdmin, requireCsrf);

app.route('/api/public', publicRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/admin/account', accountRoutes);
app.route('/api/admin/dashboard', dashboardRoutes);
app.route('/api/admin/films', filmRoutes);
app.route('/api/admin/settings', settingsRoutes);
app.route('/api/admin/uploads', uploadRoutes);
app.route('/api/admin/videos', videoRoutes);
app.route('/api/admin/storage', storageRoutes);

app.all('/api/*', () => {
  throw notFound('Такого адреса API нет.');
});

// Hono направляет HEAD в обработчик GET и сам убирает тело ответа.
app.get('/media/*', (c) => serveMedia(c.req.raw, c.env));
app.all('/media/*', () => {
  throw new ApiError(405, 'bad_request', 'Этот адрес поддерживает только GET и HEAD.');
});

app.get('/robots.txt', (c) => robotsTxt(c.env, c.req.raw));
app.get('/sitemap.xml', (c) => sitemapXml(c.env, c.req.raw));

app.all('*', (c) => serveAsset(c.req.raw, c.env));

export default app;
