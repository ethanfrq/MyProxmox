// Lance MyProxmox en mode démo (faux Proxmox), avec ses propres données dans data-demo/.
process.env.MYPROXMOX_DEMO = "1";
process.env.MYPROXMOX_DATA ??= "data-demo";
await import("../server/dist/index.js");
