import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./fonts.css";
import "./tokens.css";
import "./app.css";
import "./setup.css";
import "./goals.css";
import "./split.css";
import "./import.css";
import "./pension.css";
import "./independence.css";
import "./tracking.css";
import "./overview.css";
import "./optimizer.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
