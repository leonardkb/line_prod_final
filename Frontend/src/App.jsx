import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import PlannerPage from "./pages/PlannerPage";
import LoginPage from "./components/LoginPage";
import LineInfo from "./pages/LineInfo";
import AdminDashboard from "./pages/AdminDashboard";
import LineLeaderPage from "./pages/LineLeaderPage";
import Dashboard from "./pages/Dashboard";
import LineBalancing from "./pages/LineBalancing";
import LineTvDashboard from "./pages/LineTvDashboard";
import SkyrinaDashboard from "./pages/SkyrinaDashboard";



export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/planner" element={<PlannerPage />} /> {/* changed from /home */}
        <Route path="/line_info" element={<LineInfo />} />
        <Route path="/" element={<LoginPage />} />
        <Route path="/admin-dashboard" element={<AdminDashboard />} />
         <Route path="/admin" element={<Dashboard />} />
        <Route path="/lineleader" element={<LineLeaderPage />} />
        <Route path="/line-balancing" element={<LineBalancing />} /> {/* catch-all route */}
        <Route path="/line-tv" element={<LineTvDashboard />} /> {/* catch-all route */}
        <Route path="/skyrina" element={<SkyrinaDashboard />}/> 
      </Routes>
    </Router>
  );
}

