import React from "react";
import ReactDOM from "react-dom/client";
import "@labelu/components-react/dist/style.css";
import "@labelu/video-annotator-react/dist/style.css";

import { AnnotationApp } from "./annotation-app";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("数据标注实训云页面缺少根节点");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AnnotationApp />
  </React.StrictMode>,
);
