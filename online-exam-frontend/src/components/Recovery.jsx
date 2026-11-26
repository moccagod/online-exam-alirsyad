import { Component, lazy, Suspense } from "react";

export function incident(stage) {
  const code = Date.now().toString(36).toUpperCase();
  const ua = navigator.userAgent;
  const browser = /Android.*Chrome/.test(ua)
    ? "Chrome Android"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Chrome/.test(ua)
        ? "Chrome"
        : "Lainnya";
  console.error("Gangguan portal ujian", { code, stage, browser });
  void fetch((import.meta.env.VITE_API_BASE_URL || "/api") + "/auth/incident", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    keepalive: true,
    body: JSON.stringify({ code, stage, browser }),
  }).catch(() => {});
  return code;
}

/** @extends {Component<{children: import("react").ReactNode}>} */
class Recovery extends Component {
  constructor(props) {
    super(props);
  }
  state = { code: null };
  static getDerivedStateFromError() {
    return {
      code: incident(
        location.pathname.includes("exam")
          ? "halaman ujian"
          : "login/dashboard",
      ),
    };
  }
  render() {
    if (!this.state.code) return this.props.children;
    return (
      <main className="p-6">
        <h1>Halaman gagal dimuat</h1>
        <p>Kode kejadian {this.state.code}</p>
        <button onClick={() => location.reload()}>Coba lagi</button>
      </main>
    );
  }
}

const App = lazy(() => import("../App.tsx"));

export default function RecoveryBoundary() {
  return (
    <Recovery>
      <Suspense fallback={<p>Memuat portal?</p>}>
        <App />
      </Suspense>
    </Recovery>
  );
}
