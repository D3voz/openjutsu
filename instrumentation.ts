import type { Server } from "node:net";

// Next is already listening when register() runs, so check the real bound addresses rather than request headers.
export async function register() {
  const password = process.env.OPENJUTSU_PASSWORD;
  if (process.env.NEXT_RUNTIME === "nodejs" && password) {
    const { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT } = await import("./lib/http.ts");
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error(PASSWORD_TOO_SHORT);
      process.exit(1);
    }
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.OPENJUTSU_PASSWORD) {
    const [{ Server }, { loopbackOnly, PASSWORD_REQUIRED }] = await Promise.all([import("node:net"), import("./lib/http.ts")]);
    // _getActiveHandles() is undocumented; if it ever finds no listening server, this fails closed.
    const handles = (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles();
    const servers = handles.filter((handle): handle is Server => handle instanceof Server && handle.listening);
    if (!loopbackOnly(servers.map((server) => server.address()))) {
      console.error(PASSWORD_REQUIRED);
      process.exit(1);
    }
  }
}
