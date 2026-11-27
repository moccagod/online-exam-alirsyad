import { getUserFromToken } from "../utils/jwtHelper";
import { incident } from "../components/Recovery";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/axiosConfig";
import Swal from "sweetalert2";
import RichTextRenderer from "../components/RichTextRenderer";
import LoadingButton from "../components/LoadingButton";

/* ---------------- Helper ---------------- */

const START_TIMEOUT_MS = 30000;
const SUBMIT_TIMEOUT_MS = 30000;
const SUBMIT_RETRY_DELAY_MS = 1200;

const formatTime = (seconds) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

const hasAnswer = (answer) => typeof answer === "string" && answer.trim().length > 0;
const formatSchedule = (date) => new Date(date).toLocaleString("id-ID", {
  timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric",
  hour: "2-digit", minute: "2-digit",
});

const normalizeOptions = (options) => {
  if (Array.isArray(options)) {
    return options.map((option) => ({
      type: option.type || "text",
      value: option.value || "",
    }));
  }
  if (typeof options !== "string") return [];

  try {
    const parsed = JSON.parse(options);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const StudentExamPage = () => {
  const { examId } = useParams();
  const navigate = useNavigate();

  // Exam states
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [studentAnswers, setStudentAnswers] = useState({});
  const [activeQuestion, setActiveQuestion] = useState(0);
  const [markedQuestions, setMarkedQuestions] = useState([]);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const dialogRef = useRef(null);

  const [receiptId,setReceiptId] = useState("");
  const [loadFailed,setLoadFailed] = useState(false);
  const clockOffset = useRef(0);
  const [clock,setClock] = useState(Date.now);
  useEffect(()=>{
    const tick = setInterval(()=>setClock(Date.now()+clockOffset.current),1000);
    return ()=>clearInterval(tick);
  },[]);
  const [entryToken, setEntryToken] = useState("");
  const [prepared, setPrepared] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const stateRef = useRef({revision: 0, draft: {}});
  const deadline = useRef(0);
  const owner = useRef(getUserFromToken()?.sub);
  const storageKey = "exam-draft:" + owner.current + ":" + examId;
  const sortedQuestions = useMemo(() => [...questions].sort((a, b) =>
    a.type === b.type
      ? (a.index || 0) - (b.index || 0)
      : a.type === "multiple_choice" ? -1 : 1
  ), [questions]);
  const answeredCount = sortedQuestions.filter(q => hasAnswer(studentAnswers[q.id])).length;
  const markedCount = sortedQuestions.filter(q => markedQuestions.includes(q.id)).length;
  const restore = (data) => {
    const questions = data.questions.map(q => ({...q, options: normalizeOptions(q.options)}));
    setQuestions(questions);
    deadline.current = Date.now() + Date.parse(data.ends_at) - Date.parse(data.server_time);
    setTimeLeft(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
    setPrepared(true);
    if (data.id) {
      let saved;
      try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch { /* storage unavailable */ }
      stateRef.current = saved?.session === data.id && saved.revision > data.revision
        ? saved : {session: data.id, revision: data.revision || 0, draft: data.draft || {}};
      setStudentAnswers(stateRef.current.draft);
      setSessionId(data.id);
      try {
        const savedMarks = JSON.parse(localStorage.getItem(storageKey + ":marks:" + data.id) || "[]");
        setMarkedQuestions(Array.isArray(savedMarks) ? savedMarks.filter(id => questions.some(q => q.id === id)) : []);
      } catch { setMarkedQuestions([]); }
      setStarted(true);
    }
  };

  // Session & status
  const [started, setStarted] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startMessage, setStartMessage] = useState("Memulai ujian...");
  const [submitting, setSubmitting] = useState(false);
  const flushWarnings = useRef(async () => true);

  // Refs
  const submittingRef = useRef(false);
  const internalNavigationRef = useRef(false);
  const autoSubmittedRef = useRef(false);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  useEffect(() => {
    if (!navigatorOpen && !reviewOpen) return;
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])') || [])];
    focusable()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") { setNavigatorOpen(false); setReviewOpen(false); }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); previousFocus?.focus?.(); };
  }, [navigatorOpen, reviewOpen]);

  const allowInternalNavigation = () => {
    internalNavigationRef.current = true;
    window.__ALLOW_INTERNAL_NAVIGATION__ = true;
  };

  const blockInternalNavigation = () => {
    internalNavigationRef.current = false;
    window.__ALLOW_INTERNAL_NAVIGATION__ = false;
  };

  /* ---------------- Fetch Exam ---------------- */
  useEffect(() => {
    const fetchExam = async () => {
      try {
        const { data: examData } = await api.get(`/exams/${examId}`);

        clockOffset.current = (Date.parse(examData.server_time) || Date.now()) - Date.now();
        setClock(Date.now()+clockOffset.current);
        setExam(examData);
        const result = await api.get("/exam-submissions/" + examId + "/me");
        if (result.data.submitted && result.data.receipt) {
          setReceiptId(result.data.receipt);
          const local = JSON.parse(localStorage.getItem(storageKey) || "null");
          if (local?.session===result.data.session) {
            await api.post("/exam-sessions/"+local.session+"/review",{revision:local.revision});
          }
          return;
        }
        try {
          const {data} = await api.post("/exam-sessions/" + examId + "/prepare", {});
          restore(data);
        } catch (err) {
          setNotice(err.response?.data?.message || "Periksa koneksi dan coba lagi.");
        }
      } catch {
        setLoadFailed(true);
        setNotice("Gagal memuat ujian. Kode kejadian " + incident("jadwal"));
      } finally {
        setLoading(false);
      }
    };

    fetchExam();
  }, [examId, navigate]);

  /* ---------------- Proctoring ---------------- */
  useEffect(() => {
    if (!started) return;
    let away = false;
    const key = storageKey + ":events:" + sessionId;
    let queue = [];
    try { queue = JSON.parse(localStorage.getItem(key) || "[]"); } catch { /* storage unavailable */ }
    const persist = () => { try { localStorage.setItem(key,JSON.stringify(queue)); } catch { /* keep in memory */ } };
    let pending;
    const drain = async () => {
      while (queue.length) {
        const event = queue[0];
        try {
          const {data} = await api.post("/exam-sessions/" + sessionId + "/violation", {event});
          queue.shift(); persist();
          if (data.status === "locked") {
            queue.length=0; persist();
            setStarted(false); setPrepared(false); setNotice("Sesi terkunci. Hubungi operator.");
            return false;
          }
          void Swal.fire("Peringatan pengawasan", "Halaman ujian ditinggalkan. Kejadian ini dicatat untuk pengawas (total " + data.count + ").", "warning");
        } catch {
          setNotice("Peringatan tersimpan di perangkat. Perlu koneksi.");
          return false;
        }
      }
      return true;
    };
    const flush = () => {
      if (!pending) pending = drain().finally(()=>{pending=null;});
      return pending;
    };
    flushWarnings.current = flush;
    const leave = () => {
      if (away || submittingRef.current || internalNavigationRef.current) return;
      away = true;
      queue.push(String(Date.now()) + "-" + Math.random().toString(36).slice(2));
      persist();
      try {
        const audio = new AudioContext();
        const tone = audio.createOscillator();
        tone.connect(audio.destination); tone.start(); tone.stop(audio.currentTime + 0.25);
        tone.onended = () => audio.close();
      } catch { /* audio optional */ }
      void flush();
    };
    const handleFullscreenChange = () => {
      if (document.fullscreenElement) away=false;
      else leave();
    };
    const onInteraction = () => { if (!document.hidden) away=false; };
    document.addEventListener("pointerdown",onInteraction);
    const handleVisibilityChange = () => {
      if (document.hidden) leave();
      else away=false;
    };
    void flush();
    window.addEventListener("online",flush);
    const handleBeforeUnload = (e) => {
      if (internalNavigationRef.current || window.__ALLOW_INTERNAL_NAVIGATION__) return;
      e.preventDefault();
      e.returnValue = "";
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("pointerdown",onInteraction);
      window.removeEventListener("online",flush);
      flushWarnings.current = async()=>true;

    };
  }, [started, sessionId]);

  /* ---------------- Handlers ---------------- */
  const handleAnswerChange = (questionId, answer) => {
    const draft = {...stateRef.current.draft, [questionId]: answer};
    const next = {session:sessionId, revision:stateRef.current.revision + 1, draft};
    stateRef.current = next;
    setStudentAnswers(draft);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSaveStatus("Tersimpan di perangkat");
    } catch { setSaveStatus("Penyimpanan perangkat penuh"); }
  };

  const toggleMark = (questionId) => {
    const next = markedQuestions.includes(questionId)
      ? markedQuestions.filter(id => id !== questionId)
      : [...markedQuestions, questionId];
    setMarkedQuestions(next);
    try { localStorage.setItem(storageKey + ":marks:" + sessionId, JSON.stringify(next)); } catch { /* marker remains in memory */ }
  };

  const goToQuestion = (index) => {
    setActiveQuestion(index);
    setNavigatorOpen(false);
    setReviewOpen(false);
  };

  useEffect(() => {
    if (!sessionId || !started) return;
    let active = true;
    const sync = async () => {
      const next = stateRef.current;
      try {
        const {data} = await api.post("/exam-sessions/" + sessionId + "/draft", next);
        if (active && next === stateRef.current && data.revision === next.revision) setSaveStatus("Tersimpan di server");
      } catch {
        if (active) setSaveStatus("Perlu koneksi");
      }
    };
    const timer = setTimeout(sync, 300);
    const retry = setInterval(sync, 15000);
    window.addEventListener("online", sync);
    return () => { active = false; clearTimeout(timer); clearInterval(retry); window.removeEventListener("online", sync); };
  }, [studentAnswers, started, sessionId]);

  const requestFullscreenIfAvailable = async () => {
    const elem = document.documentElement;
    try {
      if (document.fullscreenElement) return true;
      if (elem.requestFullscreen) await elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
      else if (elem.msRequestFullscreen) await elem.msRequestFullscreen();
      else return false;
      return true;
    } catch (err) {
      console.warn("Fullscreen tidak dapat dimulai otomatis:", err);
      return false;
    }
  };

  const handleStart = async () => {
    if (starting) return;
    try {
      setStarting(true);
      setStartMessage("Menyiapkan sesi ujian...");
      const route = prepared ? "start" : "prepare";
      if (prepared) void requestFullscreenIfAvailable();
      const { data } = await api.post("/exam-sessions/" + examId + "/" + route, {token:entryToken}, {
        timeout: START_TIMEOUT_MS,
        skipAuthRedirect: true,
      });

      restore(data);
      setNotice("");
      if (!data.id) return;

      // 🔹 Robust Fullscreen Request
      setStartMessage("Mengaktifkan mode fullscreen...");
      const fullscreenStarted = await requestFullscreenIfAvailable();
      if (!fullscreenStarted) {
        Swal.fire({
          icon: "info",
          title: "Fullscreen Manual",
          text: "Jika tombol fullscreen muncul, tekan tombol tersebut untuk kembali ke mode ujian.",
          timer: 2500,
          showConfirmButton: false,
        });
      }

    } catch (err) {
      const code = incident("mulai");
      const message =
        err.response?.status === 401
          ? "Sesi login Anda sudah berakhir. Silakan login kembali sebelum memulai ujian."
          : (err.response?.data?.message || "Tidak bisa memulai sesi ujian.") + " - " + code;

      await Swal.fire("Error", message, "error");
      if (err.response?.status === 401) {
        allowInternalNavigation();
        localStorage.removeItem("token");
        navigate("/");
      }
    } finally {
      setStartMessage("Memulai ujian...");
      setStarting(false);
    }
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isRetryableSubmitError = (err) => {
    const status = err.response?.status;
    return (
      err.code === "ECONNABORTED" ||
      err.code === "ETIMEDOUT" ||
      !status ||
      status >= 500
    );
  };

  const submitExamWithRetry = useCallback(async (payload) => {
    try {
      return await api.post(`/exam-submissions/${examId}`, payload, {
        timeout: SUBMIT_TIMEOUT_MS,
      });
    } catch (err) {
      if (!isRetryableSubmitError(err)) throw err;

      Swal.update({
        title: "Mencoba mengirim ulang...",
        text: "Koneksi sempat terganggu. Sistem sedang memastikan jawaban terkirim.",
      });
      Swal.showLoading();

      await wait(SUBMIT_RETRY_DELAY_MS);
      return api.post(`/exam-submissions/${examId}`, payload, {
        timeout: SUBMIT_TIMEOUT_MS,
      });
    }
  }, [examId]);

  const handleSubmit = useCallback(async ({ auto = false } = {}) => {
    if (submittingRef.current) return;

    setReviewOpen(false);

    try {
      submittingRef.current = true;
      setSubmitting(true);

      Swal.fire({
        title: auto ? "Waktu habis. Mengirim jawaban..." : "Mengirim jawaban...",
        text: auto
          ? "Sistem sedang menyimpan jawaban yang sudah diisi."
          : "Mohon tunggu sebentar.",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
      });

      if (!auto) await flushWarnings.current();
      const payload = {
        answers: Object.entries(stateRef.current.draft).map(([question_id, answer]) => ({question_id, answer})),
        revision: stateRef.current.revision,
        sessionId: sessionId,
      };

      const {data: receipt} = await submitExamWithRetry(payload);
      if (!receipt?.id) throw new Error("Bukti penerimaan belum tersedia");
      if (receipt.revision >= stateRef.current.revision) { try { localStorage.removeItem(storageKey); } catch { /* receipt is authoritative */ } }
      else await api.post("/exam-sessions/" + sessionId + "/review", {}).catch(() => {});
      try { localStorage.removeItem(storageKey + ":marks:" + sessionId); } catch { /* receipt is authoritative */ }

      allowInternalNavigation();

      // Exit fullscreen after the answer receipt is confirmed.
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});

      await Swal.fire({
        icon: "success",
        title: "Ujian terkirim",
        text: "Bukti penerimaan " + receipt.id,
        confirmButtonText: "OK",
      });

      navigate("/student/exam");
    } catch (err) {
      const code = incident("kirim");
      if (err.response?.status === 401) {
        allowInternalNavigation();
      } else {
        blockInternalNavigation();
      }
      Swal.fire("Error", (err.response?.data?.message || err.message || "Gagal menyimpan jawaban") + " - " + code, "error");
    } finally {
      if (!internalNavigationRef.current) submittingRef.current = false;
      setSubmitting(false);
    }
  }, [navigate, sessionId, submitExamWithRetry]);

  /* ---------------- Timer ---------------- */
  useEffect(() => {
    if (!exam || !started || !sessionId) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          if (!autoSubmittedRef.current) {
            autoSubmittedRef.current = true;
            void handleSubmit({ auto: true });
          }
          return 0;
        }
        return Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [exam, handleSubmit, sessionId, started]);

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const requestFullscreen = async () => {
    const elem = document.documentElement;
    try {
      if (elem.requestFullscreen) await elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
      else if (elem.msRequestFullscreen) await elem.msRequestFullscreen();
    } catch (err) {
      console.error("Fullscreen error:", err);
    }
  };

  /* ---------------- Render ---------------- */
  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-600" role="status">Memuat informasi ujian...</main>;

  if (receiptId) return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-lg rounded-2xl border border-emerald-100 bg-white p-8 text-center shadow-sm">
        <p className="mb-3 text-sm font-semibold text-emerald-700">Ujian selesai</p>
        <h1 className="text-2xl font-bold text-slate-900">Jawaban berhasil dikirim</h1>
        <p className="mt-4 text-slate-600">Bukti penerimaan: <strong className="break-all text-slate-900">{receiptId}</strong></p>
        <button type="button" onClick={() => navigate("/student/exam")} className="mt-7 min-h-11 rounded-xl bg-emerald-700 px-5 text-white hover:bg-emerald-800">Kembali ke daftar ujian</button>
      </div>
    </main>
  );
  const isOpen = exam?.starts_at && clock >= Date.parse(exam.starts_at) && clock < Date.parse(exam.ends_at);
  const isUpcoming = exam?.starts_at && clock < Date.parse(exam.starts_at);
  const isFinished = exam?.ends_at && clock >= Date.parse(exam.ends_at);
  const countdown = isUpcoming ? Math.ceil((Date.parse(exam.starts_at) - clock) / 1000) : 0;
  if (!started) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-800 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700 text-lg font-bold text-white">AI</div>
            <div><p className="text-sm font-semibold text-slate-900">SMK Al Irsyad</p><p className="text-xs text-slate-500">Portal ujian siswa</p></div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-7 sm:px-9">
              <p className="mb-2 text-sm font-semibold text-emerald-700">{isUpcoming ? "Menunggu jadwal" : isFinished ? "Jadwal selesai" : prepared ? "Siap memulai" : "Verifikasi token"}</p>
              <h1 className="text-2xl font-bold leading-tight text-slate-900 sm:text-3xl">{exam?.title || "Ujian"}</h1>
              <p className="mt-2 text-sm text-slate-500">Periksa jadwal dan persiapkan perangkat sebelum memulai.</p>
            </div>
            <div className="grid gap-5 px-6 py-6 sm:grid-cols-2 sm:px-9">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mulai</p><p className="mt-1 font-medium">{exam?.starts_at ? formatSchedule(exam.starts_at) + " WIB" : "Belum dijadwalkan"}</p></div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selesai</p><p className="mt-1 font-medium">{exam?.ends_at ? formatSchedule(exam.ends_at) + " WIB" : "Belum dijadwalkan"}</p></div>
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-6 py-7 sm:px-9">
              {isUpcoming && <div role="status"><p className="text-lg font-semibold text-slate-900">Ujian belum dibuka</p><p className="mt-1 text-sm text-slate-600">Halaman ini akan siap untuk memasukkan token saat jadwal dimulai.</p><p className="mt-5 font-mono text-3xl font-semibold tabular-nums text-emerald-700">{formatTime(countdown)}</p><p className="mt-1 text-xs text-slate-500">Menuju waktu mulai</p></div>}
              {isFinished && <div role="status"><p className="text-lg font-semibold text-slate-900">Waktu ujian telah berakhir</p><p className="mt-1 text-sm text-slate-600">Hubungi pengawas jika Anda membutuhkan bantuan.</p></div>}
              {!isUpcoming && !isFinished && !isOpen && <div role="status"><p className="text-lg font-semibold">Jadwal belum tersedia</p><p className="mt-1 text-sm text-slate-600">Hubungi pengawas untuk memastikan jadwal ujian.</p></div>}
              {isOpen && !prepared && (
                <form onSubmit={e => { e.preventDefault(); void handleStart(); }}>
                  <label htmlFor="exam-token" className="block text-sm font-semibold text-slate-900">Token ujian</label>
                  <p className="mt-1 text-sm text-slate-600">Masukkan token yang diberikan pengawas untuk menyiapkan soal.</p>
                  <input id="exam-token" value={entryToken} onChange={e => setEntryToken(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck="false" className="mt-4 h-12 w-full max-w-sm rounded-xl border border-slate-300 bg-white px-4 font-mono text-lg tracking-widest text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="Masukkan token" />
                  <div className="mt-5"><LoadingButton type="submit" disabled={!entryToken.trim()} loading={starting} loadingText={startMessage} className="min-h-11 rounded-xl bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800">Verifikasi token</LoadingButton></div>
                </form>
              )}
              {isOpen && prepared && (
                <div>
                  <p className="text-lg font-semibold text-slate-900">Soal sudah siap</p>
                  <p className="mt-1 text-sm text-slate-600">Terdapat {questions.length} soal. Waktu ujian berakhir sesuai jadwal di atas.</p>
                  <div className="mt-5 rounded-xl border border-emerald-100 bg-white p-4 text-sm leading-relaxed text-slate-700">Saat memulai, browser akan meminta mode layar penuh. Perpindahan tab dan keluar dari layar penuh dicatat untuk pengawas. Pastikan perangkat siap dan koneksi stabil.</div>
                  <LoadingButton onClick={handleStart} loading={starting} loadingText={startMessage} className="mt-6 min-h-11 rounded-xl bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800">Mulai ujian</LoadingButton>
                </div>
              )}
              {notice && <p role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
              {loadFailed && <button type="button" onClick={() => location.reload()} className="mt-5 min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold">Coba lagi</button>}
            </div>
          </div>
          <button type="button" onClick={() => navigate("/student/exam")} className="mt-6 min-h-11 px-1 text-sm font-semibold text-emerald-700 hover:underline">Kembali ke daftar ujian</button>
        </div>
      </main>
    );
  }
  const currentQuestion = sortedQuestions[activeQuestion];
  const questionButtons = sortedQuestions.map((q, index) => {
    const answered = hasAnswer(studentAnswers[q.id]);
    const marked = markedQuestions.includes(q.id);
    return <button key={q.id} type="button" onClick={() => goToQuestion(index)} aria-label={`Soal ${index + 1}, ${answered ? "terjawab" : "belum dijawab"}${marked ? ", ragu-ragu" : ""}`} aria-current={activeQuestion === index ? "step" : undefined} className={`relative flex min-h-11 items-center justify-center rounded-lg border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${activeQuestion === index ? "border-emerald-700 bg-emerald-700 text-white" : answered ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}>{index + 1}{marked && <span aria-hidden="true" className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" />}</button>;
  });
  return (
    <div className="flex h-dvh flex-col bg-slate-50 text-slate-900">
      <header className="z-10 flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {!isFullscreen && (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen) && (
            <button type="button" onClick={requestFullscreen} className="min-h-11 shrink-0 rounded-lg bg-amber-100 px-3 text-xs font-semibold text-amber-900 hover:bg-amber-200">Kembali ke layar penuh</button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold sm:text-lg">{exam?.title}</h1>
            <p className="text-xs text-slate-500">Soal {activeQuestion + 1} dari {sortedQuestions.length}</p>
          </div>
        </div>
        <div className="shrink-0 text-right" role="timer" aria-label={`Sisa waktu ${formatTime(timeLeft)}`}><p className={`font-mono text-xl font-bold tabular-nums sm:text-2xl ${timeLeft <= 300 ? "text-rose-700" : "text-slate-900"}`}>{formatTime(timeLeft)}</p><p className="text-[11px] text-slate-500">Sisa waktu</p></div>
      </header>
      <div className="flex min-h-0 flex-1 justify-center gap-6 px-4 py-4 sm:px-6 lg:py-6">
        <main className="min-w-0 max-w-4xl flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8" key={currentQuestion?.id}>
          {currentQuestion ? <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-semibold text-emerald-700">Soal {activeQuestion + 1} dari {sortedQuestions.length}</span><span className="text-xs font-medium text-slate-500">{currentQuestion.type === "multiple_choice" ? "Pilihan ganda" : "Esai"}</span></div>
            <div className="text-lg font-medium leading-relaxed text-slate-900 sm:text-xl"><RichTextRenderer content={currentQuestion.question} className="prose-base sm:prose-lg" imageClassName="[&_img]:!max-h-[55vh] [&_img]:!w-auto [&_img]:!h-auto [&_img]:object-contain" /></div>
            {currentQuestion.type === "multiple_choice" ? <div className="mt-7 space-y-3" role="radiogroup" aria-label={`Jawaban soal ${activeQuestion + 1}`}>
              {currentQuestion.options?.map((opt, i) => <label key={i} className={`flex min-h-14 cursor-pointer items-start gap-4 rounded-xl border p-4 transition-colors ${studentAnswers[currentQuestion.id] === opt.value ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <input type="radio" name={`q-${currentQuestion.id}`} value={opt.value} onChange={() => handleAnswerChange(currentQuestion.id, opt.value)} checked={studentAnswers[currentQuestion.id] === opt.value} className="mt-1 h-5 w-5 shrink-0 accent-emerald-700" />
                {opt.type === "image" && /^https?:|^data:image\//.test(opt.value) ? <img src={opt.value} alt={`Pilihan ${String.fromCharCode(65 + i)}`} className="max-h-[42vh] max-w-full rounded-lg border bg-white object-contain" /> : <div className="min-w-0 flex-1 text-base leading-relaxed text-slate-800 sm:text-lg"><RichTextRenderer content={opt.value} imageClassName="[&_img]:!max-h-[42vh] [&_img]:!w-auto [&_img]:!h-auto [&_img]:object-contain" /></div>}
              </label>)}
            </div> : <div className="mt-7"><label htmlFor={`answer-${currentQuestion.id}`} className="mb-2 block text-sm font-semibold text-slate-700">Jawaban Anda</label><textarea id={`answer-${currentQuestion.id}`} className="min-h-40 w-full rounded-xl border border-slate-300 p-4 text-base leading-relaxed focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="Tulis jawaban di sini..." value={studentAnswers[currentQuestion.id] || ""} onChange={e => handleAnswerChange(currentQuestion.id, e.target.value)} /></div>}
          </> : <p className="text-slate-600">Tidak ada soal tersedia. Hubungi pengawas.</p>}
        </main>
        <aside className="hidden w-64 shrink-0 self-start rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:block" aria-label="Navigasi soal"><div className="flex items-center justify-between"><h2 className="text-base font-bold">Daftar soal</h2><span className="text-xs text-slate-500">{answeredCount}/{sortedQuestions.length}</span></div><div className="mt-4 grid grid-cols-5 gap-2">{questionButtons}</div><p className="mt-5 text-xs leading-relaxed text-slate-500">Hijau: terjawab · Titik kuning: ragu-ragu</p></aside>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3"><button type="button" onClick={() => setNavigatorOpen(true)} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 lg:hidden">Nomor soal</button><span role="status" className="max-w-32 text-xs text-slate-500 sm:max-w-none">{saveStatus || `${answeredCount} dari ${sortedQuestions.length} terjawab`}</span></div>
        <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => currentQuestion && toggleMark(currentQuestion.id)} disabled={!currentQuestion} aria-pressed={currentQuestion ? markedQuestions.includes(currentQuestion.id) : false} className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${currentQuestion && markedQuestions.includes(currentQuestion.id) ? "border-amber-400 bg-amber-100 text-amber-900" : "border-slate-300 text-slate-700"}`}>Ragu-ragu</button><button type="button" onClick={() => goToQuestion(activeQuestion - 1)} disabled={activeQuestion === 0} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-40">Sebelumnya</button>{activeQuestion < sortedQuestions.length - 1 ? <button type="button" onClick={() => goToQuestion(activeQuestion + 1)} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800">Berikutnya</button> : <button type="button" onClick={() => setReviewOpen(true)} disabled={!sortedQuestions.length} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Selesai</button>}</div>
      </footer>
      {navigatorOpen && <div role="presentation" className="fixed inset-0 z-30 bg-slate-950/50" onClick={() => setNavigatorOpen(false)}><div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Daftar soal" className="absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-2xl bg-white p-5" onClick={e => e.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Daftar soal</h2><button type="button" onClick={() => setNavigatorOpen(false)} className="min-h-11 px-3 text-sm font-semibold">Tutup</button></div><p className="mb-4 text-sm text-slate-600">{answeredCount} dari {sortedQuestions.length} terjawab · {markedCount} ragu-ragu</p><div className="grid grid-cols-6 gap-2 sm:grid-cols-8">{questionButtons}</div></div></div>}
      {reviewOpen && <div role="presentation" className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4" onClick={() => setReviewOpen(false)}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="review-title" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}><h2 id="review-title" className="text-xl font-bold">Periksa jawaban</h2><p className="mt-2 text-sm text-slate-600">Setelah dikirim, jawaban tidak dapat diubah.</p><div className="mt-5 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-emerald-50 p-3"><strong className="block text-xl text-emerald-800">{answeredCount}</strong><span className="text-xs">Terjawab</span></div><div className="rounded-xl bg-slate-100 p-3"><strong className="block text-xl">{sortedQuestions.length - answeredCount}</strong><span className="text-xs">Belum dijawab</span></div><div className="rounded-xl bg-amber-50 p-3"><strong className="block text-xl text-amber-800">{markedCount}</strong><span className="text-xs">Ragu-ragu</span></div></div>{(sortedQuestions.length > answeredCount || markedCount > 0) && <div className="mt-5"><p className="mb-2 text-sm font-semibold">Soal yang perlu diperiksa</p><div className="flex flex-wrap gap-2">{sortedQuestions.map((q, index) => (!hasAnswer(studentAnswers[q.id]) || markedQuestions.includes(q.id)) && <button key={q.id} type="button" onClick={() => goToQuestion(index)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50">{index + 1}{markedQuestions.includes(q.id) ? " •" : ""}</button>)}</div></div>}<div className="mt-7 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setReviewOpen(false)} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold">Kembali memeriksa</button><LoadingButton onClick={() => handleSubmit()} loading={submitting} loadingText="Mengirim..." className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800">Kirim jawaban</LoadingButton></div></div></div>}
    </div>
  );

};

export default StudentExamPage;
