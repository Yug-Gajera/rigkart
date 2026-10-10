import path from "node:path";
import type { NextConfig } from "next";

export default {
  /**
   * A stray package-lock.json in the home directory makes Next infer ~ as the
   * workspace root and warn on every start. Pin it to this project rather than
   * deleting a file that lives outside the repo.
   */
  outputFileTracingRoot: path.join(__dirname),
} satisfies NextConfig;
