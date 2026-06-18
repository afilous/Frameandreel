import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "@edgespark/client/styles.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Vite HMR
if (import.meta.hot) {
  import.meta.hot.accept();
}
