import express, { type Express } from "express";
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

export default app;
