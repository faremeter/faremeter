// @ts-check

import * as eslint from "@eslint/js";
import * as tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

const config: tseslint.Config = tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylisticTypeChecked,
  globalIgnores(["**/idl_type.ts", "**/dist/**"]),
  {
    rules: {
      "@typescript-eslint/consistent-type-definitions": 0,
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
