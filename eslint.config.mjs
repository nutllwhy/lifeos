import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The Electron shell is CommonJS and runs outside the bundler.
    files: ["desktop/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    "dist/**",
    "release/**",
    "out/**",
    ".next/**",
    ".vinext/**",
    ".wrangler/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
