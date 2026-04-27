import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "@/routes/HomePage";
import { ConvexCheckPage } from "@/routes/ConvexCheckPage";
import { ModernGamePage } from "@/routes/ModernGamePage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ModernGamePage />} />
      <Route path="/app-shell" element={<HomePage />} />
      <Route path="/54321" element={<ModernGamePage />} />
      <Route path="/convex-check" element={<ConvexCheckPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
