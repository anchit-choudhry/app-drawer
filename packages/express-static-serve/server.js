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

app.listen(PORT, () => {
  console.log(`Server Established at PORT -> ${PORT}`);
});
