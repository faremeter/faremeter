// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  globalIgnores(["**/idl_type.ts", "**/dist/**"]),
  {
    rules: {
      "@typescript-eslint/consistent-type-definitions": 0,
    },
  },
);
