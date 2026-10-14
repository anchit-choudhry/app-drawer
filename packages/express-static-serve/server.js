const express = require("express");
const expressStaticGzip = require("express-static-gzip");
const fs = require("fs");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const { verifyDist } = require("./scripts/verify-dist");

const app = express();
const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, "dist");
const SHUTDOWN_TIMEOUT_MS = 10000;
const statusUp = {
  status: "UP",
};
const compressionOrder = ["zstd", "br", "gz", "deflate"];

function setCustomCacheControl(res) {
  res.setHeader(
    "Cache-Control",
    "public, max-age=7200, must-revalidate, s-maxage=14400, proxy-revalidate"
  );
}

app.set("trust proxy", 1);
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.set("verbose errors", process.env.NODE_ENV === "development");

app.use(helmet());
app.use(morgan("combined"));

app.get("/", (req, res) => {
  res.header("Content-Type", "application/json");
  res.send(statusUp);
});

app.use(
  "/",
  expressStaticGzip(DIST_DIR, {
    enableBrotli: true,
    customCompressions: [
      { encodingName: "zstd", fileExtension: "zst" },
      { encodingName: "deflate", fileExtension: "zz" },
    ],
    serveStatic: {
      setHeaders: setCustomCacheControl,
    },
    orderPreference: compressionOrder,
  })
);

app.use((req, res) => {
  res.status(404).render("404", { url: req.originalUrl });
});

function errorHandler(err, req, res, next) {
  console.error(err);
  if (res.headersSent) {
    return next(err);
  }
  const hasErrorStatus = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599;
  res.status(hasErrorStatus ? err.status : 500).render("500", { error: err });
}

app.use(errorHandler);

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

// PM2 numbers cluster workers from 0 via NODE_APP_INSTANCE; reporting from one worker keeps
// a startup problem from being logged once per CPU.
function isFirstWorker() {
  return !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === "0";
}

function reportDistStatus() {
  if (!fs.existsSync(DIST_DIR)) {
    console.warn(`dist/ not found at ${DIST_DIR} - every request except GET / will return 404`);
    return;
  }
  if (process.env.VERIFY_DIST_ON_START === "true") {
    // dist/ is populated outside this process, so it can change or become unreadable while
    // it is scanned. The check is advisory and must never stop the server from starting.
    try {
      const { ok, problems } = verifyDist(DIST_DIR);
      if (!ok) {
        console.warn(`dist verification found problems in ${DIST_DIR}:`);
        problems.forEach((problem) => console.warn(`  - ${problem}`));
      }
    } catch (error) {
      console.warn(`dist verification could not run: ${error.message}`);
    }
  }
}

let server;
if (require.main === module) {
  if (isFirstWorker()) {
    reportDistStatus();
  }
  server = app.listen(PORT, () => {
    console.log(`Server Established at PORT -> ${PORT}`);
  });
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = app;
module.exports.errorHandler = errorHandler;
module.exports.SHUTDOWN_TIMEOUT_MS = SHUTDOWN_TIMEOUT_MS;
