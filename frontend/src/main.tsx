import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./layout.css";
import "./projects.css";
import "./dialogs.css";
import "./workflow.css";
import "./responsive.css";

createRoot(document.getElementById("root")!).render(<App />);
