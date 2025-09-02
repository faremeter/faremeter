// @ts-check

import * as eslint from "@eslint/js";
import * as tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

const checkTypes = process.env.INSIDE_STAGING_DIR !== "true";

const config: tseslint.Config = tseslint.config(
  eslint.configs.recommended,
  checkTypes ? tseslint.configs.strictTypeChecked : tseslint.configs.strict,
  checkTypes
    ? tseslint.configs.stylisticTypeChecked
    : tseslint.configs.stylistic,
  globalIgnores(["**/idl_type.ts", "**/dist/**"]),
  {
    rules: {
      "@typescript-eslint/consistent-type-definitions": 0,
      "@typescript-eslint/restrict-template-expressions": 0,
      "@typescript-eslint/no-confusing-void-expression": 0,
      "@typescript-eslint/require-await": 0,
      "@typescript-eslint/no-unnecessary-condition": 0,
      "@typescript-eslint/no-unsafe-argument": 0,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);

export default config;
