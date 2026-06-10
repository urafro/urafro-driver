// Dynamic Expo config — extends app.json. Exists ONLY to inject the Firebase
// Android config: google-services.json is gitignored (public repo stays clean),
// so EAS cloud builds receive it via the GOOGLE_SERVICES_JSON file env var
// (eas env, secret), which materializes as a file path at build time. Local
// builds fall back to the repo-root copy.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
