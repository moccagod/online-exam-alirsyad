import { Fragment, useEffect, useState } from "react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import {
  ClipboardDocumentIcon,
  ClockIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import TeacherSelect from "../DropdownTeacher";
import api from "../../api/axiosConfig";
import { getUserFromToken } from "../../utils/jwtHelper";

const wibInput = (value) =>
  value
    ? new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 16)
    : "";

const errorMessage = (error, fallback) =>
  error?.userMessage || error?.response?.data?.message || fallback;

export default function SessionControl({ exam, isOpen, onClose, refresh }) {
  const [control, setControl] = useState(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const path = exam ? `/exams/${exam.id}` : "";

  const load = async () => {
    if (!path) return;
    setLoading(true);
    setMessage("");
    try {
      setControl((await api.get(`${path}/control`)).data);
    } catch (error) {
      setMessage(errorMessage(error, "Gagal memuat jadwal dan token ujian."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !exam) return;
    setStart(wibInput(exam.starts_at));
    setEnd(wibInput(exam.ends_at));
    setControl(null);
    setPreview(null);
    setMessage("");
    load();
  }, [isOpen, exam?.id]);

  const schedule = async () => {
    if (!start || !end) {
      setMessage("Waktu mulai dan selesai wajib diisi.");
      return;
    }
    if (new Date(end) <= new Date(start)) {
      setMessage("Waktu selesai harus setelah waktu mulai.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await api.post(`${path}/control`, {
        starts_at: `${start}:00+07:00`,
        ends_at: `${end}:00+07:00`,
      });
      await load();
      await refresh?.();
      setMessage("Jadwal tersimpan dan token baru berhasil diterbitkan.");
    } catch (error) {
      setMessage(errorMessage(error, "Gagal menyimpan jadwal ujian."));
    } finally {
      setSaving(false);
    }
  };

  const unlock = async (session) => {
    try {
      await api.post(`${path}/unlock`, { session });
      await load();
      setMessage("Sesi siswa berhasil dibuka kembali.");
    } catch (error) {
      setMessage(errorMessage(error, "Gagal membuka kembali sesi siswa."));
    }
  };

  const copyToken = async () => {
    if (!control?.token) return;
    try {
      await navigator.clipboard.writeText(control.token);
      setMessage("Token berhasil disalin.");
    } catch {
      setMessage("Token tidak dapat disalin otomatis. Silakan salin secara manual.");
    }
  };

  if (!exam) return null;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[60]" onClose={saving ? () => {} : onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-2xl transform overflow-hidden rounded-2xl border border-slate-200 bg-white text-left align-middle shadow-2xl transition-all">
                <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
                  <div className="flex gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <ClockIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <DialogTitle as="h3" className="text-lg font-semibold text-slate-800">
                        Jadwal &amp; Token Ujian
                      </DialogTitle>
                      <p className="mt-0.5 text-sm text-slate-500">{exam.title}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={saving}
                    aria-label="Tutup modal"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
                  {loading && !control ? (
                    <div className="space-y-3 animate-pulse" aria-label="Memuat pengaturan ujian">
                      <div className="h-10 rounded-lg bg-slate-100" />
                      <div className="grid grid-cols-2 gap-3">
                        <div className="h-10 rounded-lg bg-slate-100" />
                        <div className="h-10 rounded-lg bg-slate-100" />
                      </div>
                      <div className="h-16 rounded-xl bg-slate-100" />
                    </div>
                  ) : (
                    <>
                      <section className="space-y-4">
                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-slate-700">Guru sesi</label>
                          {getUserFromToken()?.role === "ADMIN" ? <div className="rounded-lg border border-slate-300">
                            <TeacherSelect
                              teacherId={exam.assigned_teacher_id || exam.subject?.teacher_id}
                              setTeacherId={async (teacher) => {
                                if (!teacher) return;
                                setMessage("");
                                try {
                                  await api.post(`${path}/teacher`, { teacher });
                                  await refresh?.();
                                  setMessage("Guru sesi berhasil diperbarui.");
                                } catch (error) {
                                  setMessage(errorMessage(error, "Gagal memperbarui guru sesi."));
                                }
                              }}
                            />
                          </div> : <p className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">Guru mengikuti penugasan mengajar sesi ini.</p>}
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="block text-sm font-medium text-slate-700">
                            Mulai (WIB)
                            <input
                              type="datetime-local"
                              value={start}
                              onChange={(event) => setStart(event.target.value)}
                              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Selesai (WIB)
                            <input
                              type="datetime-local"
                              value={end}
                              onChange={(event) => setEnd(event.target.value)}
                              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            />
                          </label>
                        </div>

                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Token aktif</p>
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <code className="min-w-0 break-all text-lg font-bold tracking-widest text-slate-800">
                              {control?.token || "Belum diterbitkan"}
                            </code>
                            {control?.token && (
                              <button
                                type="button"
                                onClick={copyToken}
                                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                              >
                                <ClipboardDocumentIcon className="h-4 w-4" />
                                Salin
                              </button>
                            )}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            Menyimpan jadwal akan menerbitkan token baru dan mengganti token sebelumnya.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={schedule}
                          disabled={saving}
                          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                        >
                          {saving ? "Menyimpan..." : "Simpan Jadwal & Terbitkan Token"}
                        </button>
                      </section>

                      <section className="border-t border-slate-100 pt-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-800">Koreksi nilai</h4>
                            <p className="mt-0.5 text-xs text-slate-500">Tinjau perubahan nilai sebelum diterapkan.</p>
                          </div>
                          <button
                            type="button"
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                            onClick={async () => {
                              setMessage("");
                              try {
                                setPreview((await api.get(`${path}/recalculate`)).data);
                              } catch (error) {
                                setMessage(errorMessage(error, "Gagal memuat pratinjau hitung ulang."));
                              }
                            }}
                          >
                            Pratinjau Hitung Ulang
                          </button>
                        </div>

                        {preview && (
                          <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                            <p className="font-semibold text-slate-800">{preview.affected} siswa terdampak</p>
                            <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
                              {preview.changes.map((change) => (
                                <p key={change.id}>
                                  {change.student?.name} · {change.old} menjadi {change.proposed ?? "Periksa manual"}
                                </p>
                              ))}
                            </div>
                            {preview.affected > 0 && (
                              <button
                                type="button"
                                className="mt-3 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                                onClick={async () => {
                                  const changes = preview.changes
                                    .filter((change) => change.proposed !== null && change.old !== change.proposed)
                                    .map(({ id, old, proposed }) => ({ id, old, proposed }));
                                  try {
                                    await api.post(`${path}/recalculate`, { changes });
                                    setPreview(null);
                                    setMessage("Koreksi nilai berhasil disimpan.");
                                  } catch (error) {
                                    setMessage(errorMessage(error, "Gagal menerapkan koreksi nilai."));
                                  }
                                }}
                              >
                                Terapkan Koreksi
                              </button>
                            )}
                          </div>
                        )}
                      </section>

                      {control?.attempts?.length > 0 && (
                        <section className="border-t border-slate-100 pt-5">
                          <h4 className="text-sm font-semibold text-slate-800">Sesi peserta</h4>
                          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
                            {control.attempts.map((session) => (
                              <div key={session.id} className="p-3 text-sm text-slate-600">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p>
                                    <span className="font-medium text-slate-800">{session.student?.name}</span>
                                    <span className="mx-1.5 text-slate-300">·</span>
                                    {session.status}
                                    <span className="mx-1.5 text-slate-300">·</span>
                                    {(session.events || []).filter((event) => event.event).length} kejadian pengawasan
                                  </p>
                                  {session.status === "locked" && (
                                    <button
                                      type="button"
                                      onClick={() => unlock(session.id)}
                                      className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                                    >
                                      Buka Kembali
                                    </button>
                                  )}
                                </div>
                                {session.needs_review && (
                                  <p className="mt-1 text-xs font-medium text-amber-700">Perlu memeriksa draf perangkat.</p>
                                )}
                                {session.events?.length > 0 && (
                                  <details className="mt-2 text-xs">
                                    <summary className="cursor-pointer font-medium text-emerald-700">Tinjau kejadian pengawasan</summary>
                                    <ol className="mt-2 space-y-1 border-l border-slate-200 pl-3">
                                      {session.events.map((event, index) => (
                                        <li key={index}>
                                          {event.unlock ? "Dibuka kembali" : "Halaman ditinggalkan"}{" "}
                                          {new Date(event.unlock || event.at).toLocaleString("id-ID", {
                                            timeZone: "Asia/Jakarta",
                                          })}{" "}
                                          WIB
                                        </li>
                                      ))}
                                    </ol>
                                  </details>
                                )}
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                    </>
                  )}

                  {message && (
                    <p role="alert" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
                      {message}
                    </p>
                  )}
                </div>

                <div className="flex justify-end border-t border-slate-100 bg-slate-50/70 px-6 py-4">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={saving}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                  >
                    Tutup
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
