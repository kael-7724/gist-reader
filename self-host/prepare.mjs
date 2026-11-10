import { access, copyFile, readFile, writeFile } from "node:fs/promises";

const server = new URL("../dist/server/", import.meta.url);
try {
  await access(new URL("index.js", server));
} catch {
  throw new Error("Run npm run build before preparing the self-hosted Worker.");
}

await copyFile(new URL("./worker.mjs", import.meta.url), new URL("self-host.mjs", server));
const adminPage = await readFile(new URL("./admin.html", import.meta.url), "utf8");
await writeFile(new URL("self-host-admin-page.mjs", server), `export default ${JSON.stringify(adminPage)};\n`);
const loginPage = await readFile(new URL("./login.html", import.meta.url), "utf8");
await writeFile(new URL("self-host-login-page.mjs", server), `export default ${JSON.stringify(loginPage)};\n`);
