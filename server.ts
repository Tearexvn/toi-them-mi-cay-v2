import express from "express";
import { configureApp } from "./server/app";

// Vercel recognizes this root Express entrypoint and runs it as a Function.
// Static assets are built into /public and served by Vercel's CDN.
const app = configureApp(express());
export default app;
