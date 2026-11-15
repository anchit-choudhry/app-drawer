const express = require("express");
const expressStaticGzip = require("express-static-gzip");
const fs = require("fs");
const path = require("path");
const { createAccessLog } = require("./lib/access-log");
const { cacheControlFor } = require("./lib/cache-policy");
const { loadConfig, SHUTDOWN_TIMEOUT_MS } = require("./lib/config");
const { securityHeaders } = require("./lib/security-headers");
const { buildId } = require("./scripts/dist-manifest");
const { checkCsp } = require("./scripts/check-csp");
const { verifyDist } = require("./scripts/verify-dist");

const DEFAULT_DIST_DIR = path.join(__dirname, "dist");
const compressionOrder = ["zstd", "br", "gz", "deflate"];
const NO_STORE = "no-store";
const ALLOWED_METHODS = ["GET", "HEAD"];
// Set for the file a static response was about to send. They describe that file, not the
// error page that replaces it. Content-Type is on the list because render keeps a type that
// is already set: without it, a failed .js file turns the error page into text/javascript.
const FILE_HEADERS = [
  "Content-Encoding",
  "Content-Type",
  "ETag",
  "Last-Modified",
  "Accept-Ranges",
];

// The static layer sets these before it knows whether it will send the file: a read can fail,
// and a POST for an existing file falls through to the 404 stage. A page that takes the
// response over starts clean, and is never cached. Content-Range goes too, because it names the
// size of the file; only a 416 keeps it, since there it says which range would have been valid.
function resetFileHeaders(res, { keepContentRange = false } = {}) {
  FILE_HEADERS.forEach((header) => res.removeHeader(header));
  if (!keepContentRange) {
    res.removeHeader("Content-Range");
  }
  res.set("Cache-Control", NO_STORE);
}

// Used as `setHeaders` by both static mounts. `filePath` is the file that is about to be sent,
// which for a compressed response is the variant; lib/cache-policy.js judges the name without
// its variant extension.
function setCacheControl(res, filePath) {
  res.setHeader("Cache-Control", cacheControlFor(filePath));
}

function errorHandler(err, req, res, next) {
  console.error(err);
  if (res.headersSent) {
    return next(err);
  }
  const hasErrorStatus = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599;
  const status = hasErrorStatus ? err.status : 500;
  resetFileHeaders(res, { keepContentRange: status === 416 });
  res.status(status).render("500", { error: err });
}

// Builds the app without starting it. `distDir` is a parameter so that tests can serve a
// scratch directory; the running server always passes the package's own dist/.
function createApp(options = {}) {
  const distDir = options.distDir ?? DEFAULT_DIST_DIR;
  const config = options.config ?? loadConfig({});
  const app = express();

  app.set("trust proxy", config.trustProxy);
  app.set("views", path.join(__dirname, "views"));
  app.set("view engine", "ejs");
  // Fails closed: error details show only when the caller asks for them.
  app.set("verbose errors", options.verboseErrors === true);

  app.use(securityHeaders());
  app.use(createAccessLog(config));

  app.get("/", (req, res) => {
    // The health check is outside the static cache policy, so say that it is not cached.
    res.set("Cache-Control", NO_STORE);
    if (app.get("draining")) {
      // A load balancer that sees this stops sending new requests here.
      return res.status(503).json({ status: "DRAINING" });
    }
    res.json({ status: "UP" });
  });

  // The default for the static stage: a response that sets no policy of its own, such as the
  // 301 that serve-static sends from /sub to /sub/, is revalidated and not kept as a permanent
  // redirect. A file overrides this through setCacheControl, and errors reset it to no-store.
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-cache");
    next();
  });

  // Dot-paths are never served, with this one exception: /.well-known/ holds files that other
  // systems look up by a fixed address (security.txt, app links). Dotfiles inside it stay
  // hidden, and these files are served as they are, without compressed variants.
  app.use(
    "/.well-known",
    express.static(path.join(distDir, ".well-known"), {
      index: false,
      redirect: false,
      setHeaders: setCacheControl,
    })
  );

  app.use(
    "/",
    expressStaticGzip(distDir, {
      enableBrotli: true,
      customCompressions: [
        { encodingName: "zstd", fileExtension: "zst" },
        { encodingName: "deflate", fileExtension: "zz" },
      ],
      serveStatic: {
        setHeaders: setCacheControl,
      },
      orderPreference: compressionOrder,
    })
  );

  // Still the 404 stage: nothing above answered. Only GET and HEAD can ever be served.
  app.use((req, res) => {
    resetFileHeaders(res);
    if (!ALLOWED_METHODS.includes(req.method)) {
      res.set("Allow", ALLOWED_METHODS.join(", "));
      return res.status(405).render("405", { method: req.method });
    }
    res.status(404).render("404", { url: req.originalUrl });
  });

  app.use(errorHandler);
  return app;
}

// PM2 numbers cluster workers from 0 via NODE_APP_INSTANCE; reporting from one worker keeps
// a startup problem from being logged once per CPU.
function isFirstWorker(env) {
  return !env.NODE_APP_INSTANCE || env.NODE_APP_INSTANCE === "0";
}

function reportDistStatus(distDir, config) {
  if (!fs.existsSync(distDir)) {
    console.warn(`dist/ not found at ${distDir} - every request except GET / will return 404`);
    return;
  }
  // dist/ is populated outside this process, so it can change or become unreadable while it
  // is read. Everything here is advisory and must never stop the server from starting.
  try {
    const id = buildId(distDir);
    if (id) {
      console.log(`Serving dist build ${id}`);
    } else {
      console.warn("dist/ has no manifest - run prepare-dist, or files are served uncompressed");
    }
    if (config.verifyDistOnStart) {
      const problems = [...verifyDist(distDir).problems, ...checkCsp(distDir).problems];
      if (problems.length > 0) {
        console.warn(`dist verification found problems in ${distDir}:`);
        problems.forEach((problem) => console.warn(`  - ${problem}`));
      }
    }
  } catch (error) {
    console.warn(`dist verification could not run: ${error.message}`);
  }
}

// Unset values keep Node's own defaults.
function applyTimeouts(server, { keepAliveTimeoutMs, headersTimeoutMs }) {
  if (keepAliveTimeoutMs !== undefined) {
    server.keepAliveTimeout = keepAliveTimeoutMs;
  }
  if (headersTimeoutMs !== undefined) {
    server.headersTimeout = headersTimeoutMs;
  }
}

function createShutdown(app, server, config) {
  return function shutdown(signal) {
    if (app.get("draining")) {
      return;
    }
    // From now on GET / answers 503. The server keeps accepting requests for the grace
    // period, so a load balancer can notice before the listening socket closes.
    app.set("draining", true);
    console.log(`Received ${signal}, shutting down gracefully`);
    setTimeout(() => {
      server.close(() => {
        process.exit(0);
      });
    }, config.shutdownGraceMs);
    // Counted from the signal, so the grace period never extends the shutdown window.
    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  };
}

// Starts the server. The environment is parsed before listening, so every worker stops on a
// bad value before it can accept a connection.
function start(options = {}) {
  const env = options.env ?? process.env;
  const distDir = options.distDir ?? DEFAULT_DIST_DIR;
  const config = loadConfig(env);
  const app = createApp({ distDir, config, verboseErrors: env.NODE_ENV === "development" });
  if (isFirstWorker(env)) {
    reportDistStatus(distDir, config);
  }
  const server = app.listen(config.port, (error) => {
    // Express 5 hands a listen failure, such as a port in use, to this callback.
    if (error) {
      throw error;
    }
    console.log(`Server Established at PORT -> ${server.address().port}`);
  });
  applyTimeouts(server, config);
  const shutdown = createShutdown(app, server, config);
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start, errorHandler, applyTimeouts, SHUTDOWN_TIMEOUT_MS };
