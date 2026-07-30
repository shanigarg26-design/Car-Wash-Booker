import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import session from "express-session";
import router from "./gateway/index.js";

const app: Express = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "carwash-secret-key-2024",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
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
