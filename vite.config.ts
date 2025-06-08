import { resolve } from "path";
import { defineConfig } from "vite";
const root = resolve(__dirname, "src");
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [tailwindcss()],
    root,
    build: {
        outDir: "dist",
    },
    base: "./",
});
