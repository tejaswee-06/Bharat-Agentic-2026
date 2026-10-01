import React from "react";
import { createRoot } from "react-dom/client";
import KavachApp from "./KavachApp";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <KavachApp />
  </React.StrictMode>
);
