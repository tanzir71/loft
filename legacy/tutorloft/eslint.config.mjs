import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "sample_code - reference only/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
