import app from "./app";

// Last-resort safety net: never let a stray async error take the whole server down.
// The per-request error handler in app.ts handles normal cases; these just keep the
// process alive if something slips through.
process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
process.on("uncaughtException",  (err)    => console.error("[uncaughtException]", err));

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
