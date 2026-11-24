// Development entry (npm run dev): the unobfuscated site, never cached.
// Set before index.js loads its .env, which never overrides a variable that's already set.
process.env.SHADOW_DEV = "1";
process.env.SHADOW_OBFUSCATE = "off";
await import("./index.js");
