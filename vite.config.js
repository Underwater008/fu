import { defineConfig, loadEnv } from 'vite';

// Dev-only plugin: routes /api/* requests to Vercel-style serverless handlers
function apiRoutes() {
  return {
    name: 'api-routes',
    configureServer(server) {
      // Load all env vars (not just VITE_*) into process.env for server-side handlers
      const env = loadEnv('development', process.cwd(), '');
      Object.assign(process.env, env);
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        // Map URL to handler file, e.g. /api/create-checkout-session -> ./api/create-checkout-session.js
        const route = req.url.split('?')[0]; // strip query string
        const filePath = `.${route}.js`;

        let handler;
        try {
          // Use Vite's ssrLoadModule so env and ESM imports work
          const mod = await server.ssrLoadModule(filePath);
          handler = mod.default;
        } catch {
          return next(); // file not found, let Vite handle it
        }

        if (typeof handler !== 'function') return next();

        // Parse JSON body for POST requests
        if (req.method === 'POST' && !req.body) {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const raw = Buffer.concat(chunks).toString();
          try {
            req.body = JSON.parse(raw);
          } catch {
            req.body = {};
          }
        }

        // Adapt Node http response to Vercel-style res.status().json()
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (data) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };

        try {
          await handler(req, res);
        } catch (err) {
          console.error(`API error [${route}]:`, err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [apiRoutes()],
});
