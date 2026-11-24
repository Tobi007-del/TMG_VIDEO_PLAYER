import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);

  return {
    base: "./",
    envPrefix: ["VITE_", "GEMINI_"],
    publicDir: "public",
    plugins: [
      {
        name: "dev-api-handler",
        configureServer(server) {
          server.middlewares.use("/api/log-ip", async (req, res) => {
            if (req.method === "OPTIONS") {
              res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
              return res.end();
            }
            let bodyStr = "";
            req.on("data", (chunk) => (bodyStr += chunk));
            req.on("end", async () => {
              try {
                const { default: handler } = await import("./api/log-ip.js");
                const webReq = new Request(`http://localhost:5173${req.url}`, { method: req.method, headers: req.headers, body: req.method !== "GET" && req.method !== "HEAD" ? bodyStr : undefined });
                const webRes = await handler(webReq);
                res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
                res.end(await webRes.text());
              } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          });
        },
      },
    ],
    server: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      assetsDir: "assets",
      rollupOptions: {
        input: {
          main: "./index.html",
        },
      },
    },
  };
});
