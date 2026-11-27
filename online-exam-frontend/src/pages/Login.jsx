import {incident} from "../components/Recovery";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axiosConfig";
import { FaUser, FaLock, FaArrowRight } from "react-icons/fa";
import { getUserFromToken } from "../utils/jwtHelper";

const Login = () => {
  const [userid, setUserid] = useState("");
  const [password, setPassword] = useState("");
  const [changeRequired, setChangeRequired] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const user = getUserFromToken();
    if (user) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!userid.trim() || !password.trim()) {
      setError("Silakan masukkan ID Pengguna dan Kata Sandi!");
      return;
    }

    setLoading(true);

    try {
      const res = await api.post("/auth/login", {
        userid: String(userid).trim(),
        password: String(password),
        ...(changeRequired && {new_password: replacement}),
      });

      if (res.data.must_change_password) { setChangeRequired(true); return; }
      localStorage.setItem("token", res.data.access_token);
      const resume = JSON.parse(sessionStorage.getItem("resumeExam") || "null");
      sessionStorage.removeItem("resumeExam");
      navigate(resume?.tokenUser === getUserFromToken()?.sub && /^\/student\/exam\/[\w-]+$/.test(resume.path) ? resume.path : "/dashboard");
    } catch (err) {
      const code = err.response?.status===401 ? "" : " - " + incident("login");
      setError((err.response?.data?.message || "Login gagal. Coba lagi.") + code);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50 font-poppins overflow-hidden">
      {/* Visual Section */}
      <div className="hidden lg:flex lg:w-3/5 bg-slate-900 relative items-center justify-center p-12 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src="/img/login-background.png" 
            className="w-full h-full object-cover opacity-40 mix-blend-overlay"
            alt="Background" 
          />
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-900 via-slate-900/80 to-emerald-500/20"></div>
        </div>
        
        <div className="relative z-10 max-w-xl text-white">
          <img src="/img/logo.png" alt="Logo SMK Al Irsyad" className="w-28 h-20 object-contain mb-8" />
          <h1 className="text-5xl font-black tracking-tight leading-tight mb-6">
            SMK AL IRSYAD <br />
            <span className="text-emerald-400">CBT</span>
          </h1>
          <p className="text-xl text-slate-300 leading-relaxed font-medium">
            Platform asesmen modern untuk mendukung kemajuan akademik siswa secara transparan dan efisien.
          </p>
          
          <div className="mt-12 flex gap-8">
            <div>
              <p className="text-3xl font-black text-white">100%</p>
              <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mt-1">Aman</p>
            </div>
            <div className="h-12 w-px bg-slate-700"></div>
            <div>
              <p className="text-3xl font-black text-white">Realtime</p>
              <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mt-1">Monitoring</p>
            </div>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl"></div>
        <div className="absolute top-1/2 -right-32 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl"></div>
      </div>

      {/* Form Section */}
      <div className="w-full lg:w-2/5 flex flex-col justify-center items-center p-8 sm:p-12 md:p-16 bg-white relative">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-3">
             <img src="/img/logo.png" alt="Logo SMK Al Irsyad" className="h-12 w-12 shrink-0 object-contain" />
             <h2 className="text-lg font-black text-slate-900 tracking-tight">SMK AL IRSYAD CBT</h2>
          </div>

          <div className="mb-10">
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Login ke Akun</h2>
            <p className="text-slate-500 mt-2 font-medium">Silakan masukkan kredensial Anda untuk melanjutkan.</p>
          </div>

          {error && (
            <div className="bg-rose-50 border-l-4 border-rose-500 text-rose-700 p-4 mb-8 rounded-xl animate-in fade-in slide-in-from-top-2">
              <p className="text-sm font-bold">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            {changeRequired && <label className="block">Ganti kata sandi awal<input type="password" autoComplete="new-password" required minLength={8} className="block w-full border rounded p-3" value={replacement} onChange={e => setReplacement(e.target.value)} /></label>}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 uppercase tracking-wider ml-1">ID Pengguna / NIS</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors group-focus-within:text-emerald-500 text-slate-400">
                  <FaUser className="text-lg" />
                </div>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="Masukkan NIS / NIK"
                  className="w-full py-4 pl-12 pr-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 focus:bg-white outline-none transition-all font-semibold text-slate-700"
                  value={userid}
                  onChange={(e) => setUserid(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 uppercase tracking-wider ml-1">Kata Sandi</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors group-focus-within:text-emerald-500 text-slate-400">
                  <FaLock className="text-lg" />
                </div>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Masukkan Password"
                  className="w-full py-4 pl-12 pr-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 focus:bg-white outline-none transition-all font-semibold text-slate-700"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex items-center">
                 <input type="checkbox" id="remember" className="h-4 w-4 text-emerald-500 border-slate-300 rounded focus:ring-emerald-500" />
                 <label htmlFor="remember" className="ml-2 text-sm font-bold text-slate-500">Ingat Saya</label>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-4 rounded-2xl bg-slate-900 text-white font-black text-lg hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 hover:shadow-2xl hover:shadow-slate-300 flex items-center justify-center gap-3 active:scale-[0.98] ${
                loading ? "opacity-70 cursor-not-allowed" : ""
              }`}
            >
              {loading ? (
                <div className="h-6 w-6 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>
                  Masuk Sekarang
                  <FaArrowRight className="text-sm" />
                </>
              )}
            </button>
          </form>

          <div className="mt-10 text-center">
            <p className="text-sm font-semibold leading-relaxed text-slate-500">
              Belum memiliki akun atau mengalami kendala akun?{" "}
              <span className="text-emerald-700">Hubungi admin/operator sekolah.</span>
            </p>
          </div>
        </div>

        <div className="absolute bottom-8 text-center w-full">
           <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">
             © {new Date().getFullYear()} SMK AL IRSYAD CBT — Versi 2.0
           </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
