const express = require("express");
const expressStaticGzip = require("express-static-gzip");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");

const app = express();
const PORT = 3000;
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

// Middleware to serve static files from 'dist' directory
// app.use(express.static(path.join(__dirname, 'dist')));

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
    serveStatic: {
      setHeaders: setCustomCacheControl,
    },
    orderPreference: compressionOrder,
  })
);

app.listen(PORT, () => {
  console.log(`Server Established at PORT -> ${PORT}`);
});
