import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import session from "express-session";
import router from "./gateway/index.js";

const app: Express = express();

// Render terminates TLS at its proxy and forwards to us over HTTP with
// `X-Forwarded-Proto: https`. Trusting the first proxy lets `req.secure` reflect
// the real HTTPS connection, which is required for `secure` session cookies to be set.
app.set("trust proxy", 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "carwash-secret-key-2024",
  resave: false,
  saveUninitialized: false,
  cookie: {
    // "auto" → Secure flag in production (HTTPS via the proxy) but not on a local
    //   HTTP dev server, so both environments work without a manual toggle.
    secure: "auto",
    httpOnly: true,        // JS can't read the cookie (XSS defence)
    sameSite: "none",      // allow the cookie on the app's cross-origin API calls
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// Avatars are now served from the database (see user router GET /api/avatars/:userId),
// so they survive Render redeploys. No local static mount needed.
app.use("/api", router);

// Central error handler. Express 5 forwards rejected promises from async route
// handlers here, so an unexpected error (e.g. a transient DB failure) returns a
// clean 500 to the client instead of crashing the server or hanging the request.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("[UnhandledError]", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "server_error", message: "Something went wrong. Please try again." });
};
app.use(errorHandler);

export default app;
