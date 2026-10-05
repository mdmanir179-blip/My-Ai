import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import { apiApp } from "./api/index.js";

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    apiApp.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      apiApp.use(express.static(distPath));
      apiApp.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  apiApp.listen(PORT, "0.0.0.0", () => {
    console.log(`MS Agent Server running on http://localhost:${PORT}`);
  });
}

startServer();

export default apiApp;
