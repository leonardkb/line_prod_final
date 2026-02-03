import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

export default function LoginPage() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Use full backend URL (adjust port if different)
      const response = await axios.post("http://localhost:5000/api/login", {
        username,
        password
      });

      const user = response.data.user;

// normalize: "line_leader" / "Line Leader" / "lineleader" => "lineleader"
const roleNorm = String(user?.role || "")
  .toLowerCase()
  .trim()
  .replace(/[\s_-]/g, "");

localStorage.setItem("token", response.data.token);
localStorage.setItem("user", JSON.stringify(user));

console.log("User role raw:", user?.role, "normalized:", roleNorm);

if (roleNorm === "lineleader") {
  navigate("/lineleader", { replace: true });
} else {
  navigate("/planner", { replace: true });
}

    } catch (err) {
      if (err.response && err.response.data) {
        setError(err.response.data.error || "Login failed");
      } else if (err.code === 'ERR_NETWORK') {
        setError("Cannot connect to server. Please ensure backend is running on port 5000.");
      } else {
        setError("Network error. Please try again.");
      }
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-lg p-6 sm:p-8">
        <h1 className="text-2xl font-semibold text-gray-900 text-center">
          Production Line System
        </h1>
        <p className="text-sm text-gray-600 text-center mt-1">
          Enter your credentials to continue
        </p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              className="w-full rounded-xl border border-gray-300 px-4 py-2
                         focus:outline-none focus:ring-2 focus:ring-gray-900/20"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full rounded-xl border border-gray-300 px-4 py-2
                         focus:outline-none focus:ring-2 focus:ring-gray-900/20"
              required
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gray-900 text-white py-2.5
                       font-medium hover:bg-gray-800 active:bg-gray-900
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <div className="mt-6 text-xs text-gray-500 text-center">
          Authorized users only. Contact system administrator for access.
        </div>
        
        {/* Server status indicator (for debugging) */}
        <div className="mt-4 text-xs text-center">
          <button 
            onClick={() => window.open("http://localhost:5000/api/health", "_blank")}
            className="text-blue-500 hover:underline"
          >
            Check server status
          </button>
        </div>
      </div>
    </div>
  );
}