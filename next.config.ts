import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home directory makes Turbopack infer the
  // wrong workspace root, so pin it to this project.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
