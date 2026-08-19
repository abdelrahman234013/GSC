require("dotenv").config();
const express = require("express");

const app = express();
const PORT = process.env.PORT;

app.use(express.json());

// Simple health check — also used by the Docker healthcheck below.
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`GSC backend listening on port ${PORT}`);
});
