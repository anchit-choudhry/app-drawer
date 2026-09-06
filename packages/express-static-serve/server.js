const express = require("express");
const expressStaticGzip = require("express-static-gzip");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = 10000;
const statusUp = {
  status: "UP",
};
const compressionOrder = ["zstd", "br", "gz", "deflate"];

function setCustomCacheControl(res, file) {
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
  expressStaticGzip(path.join(__dirname, "dist"), {
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).render("500", { error: err });
});

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

let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`Server Established at PORT -> ${PORT}`);
  });
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = app;
