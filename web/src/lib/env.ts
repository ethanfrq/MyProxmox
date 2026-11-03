declare const __DEMO__: boolean;
/** true dans la version publiée sur Vercel : tout tourne dans le navigateur avec de fausses données. */
export const DEMO: boolean = typeof __DEMO__ !== "undefined" && __DEMO__;
export const BASENAME = DEMO ? "/demo" : "/";
export const REPO_URL = "https://github.com/ethanfrq/MyProxmox";
