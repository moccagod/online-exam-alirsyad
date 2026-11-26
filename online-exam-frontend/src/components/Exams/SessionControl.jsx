import TeacherSelect from "../DropdownTeacher";
import { useState } from "react";
import api from "../../api/axiosConfig";
import { getUserFromToken } from "../../utils/jwtHelper";

const wibInput = (value) =>
  value
    ? new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 16)
    : "";

export default function SessionControl({ exam, refresh }) {
  const [configured, setConfigured] = useState(Boolean(exam.starts_at));
  const [control, setControl] = useState(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [start, setStart] = useState(wibInput(exam.starts_at));
  const [end, setEnd] = useState(wibInput(exam.ends_at));
  const path = "/exams/" + exam.id;
  if (getUserFromToken()?.role !== "ADMIN") return null;
  async function load() {
    try {
      setControl((await api.get(path + "/control")).data);
    } catch (e) {
      setMessage(e.userMessage);
    }
  }
  async function schedule() {
    try {
      await api.post(path + "/control", {
        starts_at: start + ":00+07:00",
        ends_at: end + ":00+07:00",
      });
      setConfigured(true);
      await load();
    } catch (e) {
      setMessage(e.userMessage);
    }
  }
  async function unlock(session) {
    try {
      await api.post(path + "/unlock", { session });
      await load();
    } catch (e) {
      setMessage(e.userMessage);
    }
  }
  return (
    <div className="text-sm text-slate-700">
      <button
        className="text-emerald-700 underline"
        onClick={() => (control ? setControl(null) : load())}
      >
        {configured ? "Kelola jadwal WIB" : "Perlu dilengkapi"}
      </button>
      {control && (
        <div className="space-y-2 p-2">
          <label className="block">
            Guru sesi
            <TeacherSelect
              teacherId={exam.assigned_teacher_id || exam.subject?.teacher_id}
              setTeacherId={async (teacher) => {
                if (!teacher) return;
                try {
                  await api.post(path + "/teacher", { teacher });
                  refresh?.();
                } catch (e) {
                  setMessage(e.userMessage);
                }
              }}
            />
          </label>
          <label className="block">
            Mulai WIB{" "}
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="block">
            Selesai WIB{" "}
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <p>Token {control.token || "belum dibuat"}</p>
          <button onClick={schedule}>
            Simpan jadwal dan terbitkan token baru
          </button>
          <button
            className="block"
            onClick={async () => {
              try {
                setPreview((await api.get(path + "/recalculate")).data);
              } catch (e) {
                setMessage(e.userMessage);
              }
            }}
          >
            Pratinjau hitung ulang
          </button>
          {preview && (
            <div>
              <p>{preview.affected} siswa terdampak</p>
              {preview.changes.map((c) => (
                <p key={c.id}>
                  {c.student?.name} | {c.old} menjadi{" "}
                  {c.proposed ?? "Periksa manual"}
                </p>
              ))}
              {preview.affected > 0 && (
                <button
                  onClick={async () => {
                    const changes = preview.changes
                      .filter(
                        (c) => c.proposed !== null && c.old !== c.proposed,
                      )
                      .map(({ id, old, proposed }) => ({ id, old, proposed }));
                    try {
                      await api.post(path + "/recalculate", { changes });
                      setPreview(null);
                      setMessage("Koreksi tersimpan");
                    } catch (e) {
                      setMessage(e.userMessage);
                    }
                  }}
                >
                  Terapkan koreksi
                </button>
              )}
            </div>
          )}
          {control.attempts.map((s) => (
            <div key={s.id}>
              {s.student?.name} - {s.status} - {s.events?.length} kejadian
              {s.events?.length > 0 && (
                <details>
                  <summary>Riwayat pengawasan</summary>
                  <ol>
                    {s.events.map((event, index) => (
                      <li key={index}>
                        {event.unlock
                          ? "Dibuka kembali"
                          : "Halaman ditinggalkan"}{" "}
                        {new Date(event.unlock || event.at).toLocaleString(
                          "id-ID",
                          { timeZone: "Asia/Jakarta" },
                        )}{" "}
                        WIB
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {s.needs_review && " - Periksa draf perangkat"}
              {s.status === "locked" && (
                <button onClick={() => unlock(s.id)}>Buka kembali</button>
              )}
            </div>
          ))}
        </div>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
