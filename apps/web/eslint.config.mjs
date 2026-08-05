import reactConfig from "@multica/eslint-config/react";

export default [
  ...reactConfig,
  {
    ignores: [".source/"],
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    rules: {
      "react/display-name": "off",
    },
  },
];
