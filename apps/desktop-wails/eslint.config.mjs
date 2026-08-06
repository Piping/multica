import reactConfig from "@multica/eslint-config/react";

export default [
  ...reactConfig,
  {
    ignores: ["bin/", "frontend/dist/", "**/*.go"],
  },
];
