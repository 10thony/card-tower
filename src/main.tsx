import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {convex ? (
      <ConvexProvider client={convex}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ConvexProvider>
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </React.StrictMode>
);
