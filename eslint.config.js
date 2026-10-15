const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**", "web-ext-artifacts/**", "coverage/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: [
      "background/**/*.js",
      "popup/**/*.js",
      "shared/**/*.js",
      "scripts/**/*.js",
      "content/**/*.js",
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        browser: "readonly",
        MeetingsProtocol: "readonly",
        MeetingsNativeClient: "readonly",
        MeetingsMeetTab: "readonly",
        MeetingsPopupState: "readonly",
        MeetingsPopupController: "readonly",
        MeetingsBackgroundController: "readonly",
        MeetingsMeetEventSchema: "readonly",
        MeetingsMeetParticipantDiff: "readonly",
        MeetingsMeetSpeakerDiff: "readonly",
        MeetingsMeetDomSnapshot: "readonly",
        MeetingsMeetObservation: "readonly",
      },
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
