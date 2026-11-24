import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  assetsInclude: ["**/*.gz"],
  build: { modulePreload: false, assetsInlineLimit: 48_000 },
  plugins: [
    {
      name: "portable-static-entry",
      enforce: "post",
      generateBundle(_, bundle) {
        // A classic entry and an embedded terrain texture also work on a file URL.
        const html = bundle["index.html"];
        const entry = Object.values(bundle).find(
          (file) => file.type === "chunk" && file.isEntry,
        );
        if (!html || !entry) return;
        const texture = readFileSync(
          new URL("./public/images/sanctuary.webp", import.meta.url),
        ).toString("base64");
        html.source = String(html.source)
          .replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, "")
          .replace(
            '<link rel="stylesheet" crossorigin',
            '<link rel="stylesheet"',
          )
          .replace(/<link rel="preload"[^>]*sanctuary\.webp[^>]*>/, "")
          .replace(
            'src="./images/sanctuary.webp"',
            'src="data:image/webp;base64,' + texture + '"',
          )
          .replace(
            "</body>",
            () =>
              "<script>" +
              entry.code.replace(/<\/script/gi, "<\\/script") +
              "</script></body>",
          );
        delete bundle[entry.fileName];
      },
    },
  ],
});
