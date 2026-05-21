import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";
import { MalpracticeProvider } from "./context/MalpracticeContext";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <MalpracticeProvider>
          <App />
        </MalpracticeProvider>
      </AuthProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: "#111120",
            color: "#f1f5f9",
            border: "1px solid #1e1e35",
            borderRadius: "10px",
            fontSize: "0.875rem",
            fontFamily: "'Inter', sans-serif",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          },
          success: {
            iconTheme: { primary: "#22c55e", secondary: "#111120" },
          },
          error: {
            iconTheme: { primary: "#ef4444", secondary: "#111120" },
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
);
