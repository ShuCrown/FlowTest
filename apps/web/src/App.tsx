import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./Shell.js";
import { EditorPage } from "./pages/EditorPage.js";
import { FlowsPage } from "./pages/FlowsPage.js";
import { MatrixPage } from "./pages/MatrixPage.js";
import { RecordingsPage } from "./pages/RecordingsPage.js";
import { RunDetailPage } from "./pages/RunDetailPage.js";
import { RunsPage } from "./pages/RunsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { SystemsPage } from "./pages/SystemsPage.js";

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<FlowsPage />} />
        <Route path="systems" element={<SystemsPage />} />
        <Route path="flows/:id" element={<EditorPage />} />
        <Route path="flows/:id/matrix" element={<MatrixPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<RunDetailPage />} />
        <Route path="recordings" element={<RecordingsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
