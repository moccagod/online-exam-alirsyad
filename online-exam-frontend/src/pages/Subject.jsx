import { useEffect, useMemo, useState } from "react";
import { FaBookOpen, FaChalkboardTeacher, FaLayerGroup, FaPlus, FaTrash } from "react-icons/fa";
import Swal from "sweetalert2";
import Sidebar from "../components/Sidebar";
import LoadingButton from "../components/LoadingButton";
import api from "../api/axiosConfig";
import { getUserFromToken } from "../utils/jwtHelper";

const emptySubject = { name: "", description: "" };
const emptyAssignment = { subject_id: "", teacher_id: "", class_ids: [] };
const relation = (value) => (Array.isArray(value) ? value[0] : value);

export default function Subjects() {
  const isAdmin = getUserFromToken()?.role === "ADMIN";
  const [tab, setTab] = useState(isAdmin ? "subjects" : "mine");
  const [subjects, setSubjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [subjectForm, setSubjectForm] = useState(emptySubject);
  const [assignmentForm, setAssignmentForm] = useState(emptyAssignment);
  const [editingSubject, setEditingSubject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const requests = [api.get("/subjects/all"), api.get("/teaching-assignments")];
      if (isAdmin) {
        requests.push(api.get("/classes/all"));
        requests.push(api.get("/users/role", { params: { role: "GURU", page: 1, limit: 1000 } }));
      }
      const [subjectRes, assignmentRes, classRes, teacherRes] = await Promise.all(requests);
      setSubjects(subjectRes.data?.data || []);
      setAssignments(assignmentRes.data?.data || []);
      setClasses(classRes?.data?.data || []);
      setTeachers(teacherRes?.data?.data || []);
    } catch (error) {
      Swal.fire("Gagal memuat data", error.userMessage || "Data akademik tidak dapat dimuat.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const groups = new Map();
    assignments.forEach((assignment) => {
      const subject = relation(assignment.subject);
      const classRow = relation(assignment.class);
      const teacher = relation(assignment.teacher);
      if (!subject) return;
      const key = `${subject.id}:${teacher?.id || assignment.teacher_id}`;
      if (!groups.has(key)) groups.set(key, { subject, teacher, assignments: [] });
      groups.get(key).assignments.push({ ...assignment, class: classRow });
    });
    return Array.from(groups.values()).sort((a, b) => a.subject.name.localeCompare(b.subject.name, "id"));
  }, [assignments]);

  const saveSubject = async () => {
    const name = subjectForm.name.trim();
    if (!name) return Swal.fire("Nama mapel wajib diisi", "", "warning");
    setSaving(true);
    try {
      if (editingSubject) await api.put(`/subjects/${editingSubject}`, { ...subjectForm, name });
      else await api.post("/subjects", { ...subjectForm, name });
      setSubjectForm(emptySubject);
      setEditingSubject(null);
      await load();
    } catch (error) {
      Swal.fire("Mapel belum tersimpan", error.userMessage || "Periksa kembali isian.", "error");
    } finally { setSaving(false); }
  };

  const saveAssignment = async () => {
    if (!assignmentForm.subject_id || !assignmentForm.teacher_id || assignmentForm.class_ids.length === 0) {
      return Swal.fire("Lengkapi penugasan", "Pilih mapel, guru, dan minimal satu kelas.", "warning");
    }
    setSaving(true);
    try {
      await api.post("/teaching-assignments", assignmentForm);
      setAssignmentForm(emptyAssignment);
      await load();
      Swal.fire({ icon: "success", title: "Penugasan tersimpan", timer: 1300, showConfirmButton: false });
    } catch (error) {
      Swal.fire("Penugasan belum tersimpan", error.userMessage || "Periksa kembali pilihan.", "error");
    } finally { setSaving(false); }
  };

  const removeAssignment = async (id) => {
    const answer = await Swal.fire({ title: "Hapus penugasan?", text: "Ujian dan nilai lama tidak ikut terhapus.", icon: "warning", showCancelButton: true, confirmButtonText: "Hapus", cancelButtonText: "Batal" });
    if (!answer.isConfirmed) return;
    try { await api.delete(`/teaching-assignments/${id}`); await load(); }
    catch (error) { Swal.fire("Gagal", error.userMessage || "Penugasan tidak dapat dihapus.", "error"); }
  };

  const toggleClass = (classId) => setAssignmentForm((current) => ({
    ...current,
    class_ids: current.class_ids.includes(classId) ? current.class_ids.filter((id) => id !== classId) : [...current.class_ids, classId],
  }));

  return (
    <Sidebar>
      <main className="module-shell font-poppins">
        <header className="module-header">
          <div className="module-title-wrap">
            <div className="module-icon"><FaBookOpen /></div>
            <div>
              <h1 className="module-title">{isAdmin ? "Data Akademik" : "Mapel Saya"}</h1>
              <p className="mt-1 text-sm text-slate-500">{isAdmin ? "Pisahkan master mapel dari guru dan kelas pengampu." : "Mapel dan kelas yang ditugaskan kepada akun Anda."}</p>
            </div>
          </div>
        </header>

        {isAdmin && (
          <nav className="mt-6 flex gap-2 border-b border-slate-200" aria-label="Bagian data akademik">
            {[["subjects", "Master Mapel", FaLayerGroup], ["assignments", "Penugasan Mengajar", FaChalkboardTeacher]].map(([value, label, Icon]) => (
              <button key={value} type="button" onClick={() => setTab(value)} className={`flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors ${tab === value ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}><Icon /> {label}</button>
            ))}
          </nav>
        )}

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-36 animate-pulse rounded-2xl bg-slate-200" />)}</div>
        ) : tab === "subjects" && isAdmin ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">Master mata pelajaran</h2><p className="mt-1 text-sm text-slate-500">Satu nama mapel cukup dibuat sekali.</p></div>
              <div className="divide-y divide-slate-100">
                {subjects.map((subject) => (
                  <div key={subject.id} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50">
                    <div className="min-w-0"><p className="font-medium text-slate-900">{subject.name}</p><p className="truncate text-sm text-slate-500">{subject.description || "Tanpa deskripsi"}</p></div>
                    <button type="button" onClick={() => { setEditingSubject(subject.id); setSubjectForm({ name: subject.name, description: subject.description || "" }); }} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">Ubah</button>
                  </div>
                ))}
              </div>
            </div>
            <aside className="h-fit rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><FaPlus /></span><div><h2 className="font-semibold text-slate-900">{editingSubject ? "Ubah mapel" : "Tambah mapel"}</h2><p className="text-xs text-slate-500">Guru dan kelas dipilih pada penugasan.</p></div></div>
              <label className="mt-5 block text-sm font-medium text-slate-700">Nama mapel<input value={subjectForm.name} onChange={(event) => setSubjectForm((form) => ({ ...form, name: event.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label>
              <label className="mt-4 block text-sm font-medium text-slate-700">Deskripsi<textarea value={subjectForm.description} onChange={(event) => setSubjectForm((form) => ({ ...form, description: event.target.value }))} rows="3" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label>
              <div className="mt-5 flex gap-2"><LoadingButton loading={saving} onClick={saveSubject} className="min-h-11 flex-1 rounded-lg bg-emerald-600 px-4 font-semibold text-white hover:bg-emerald-700">Simpan mapel</LoadingButton>{editingSubject && <button type="button" onClick={() => { setEditingSubject(null); setSubjectForm(emptySubject); }} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700">Batal</button>}</div>
            </aside>
          </section>
        ) : tab === "assignments" && isAdmin ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
            <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-slate-900">Buat penugasan</h2><p className="mt-1 text-sm text-slate-500">Satu guru dapat menerima beberapa kelas sekaligus.</p>
              <label className="mt-5 block text-sm font-medium text-slate-700">Mata pelajaran<select value={assignmentForm.subject_id} onChange={(event) => setAssignmentForm((form) => ({ ...form, subject_id: event.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3"><option value="">Pilih mapel</option>{subjects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
              <label className="mt-4 block text-sm font-medium text-slate-700">Guru pengampu<select value={assignmentForm.teacher_id} onChange={(event) => setAssignmentForm((form) => ({ ...form, teacher_id: event.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3"><option value="">Pilih guru</option>{teachers.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.userid}</option>)}</select></label>
              <fieldset className="mt-4"><legend className="text-sm font-medium text-slate-700">Kelas yang diajar</legend><div className="mt-2 grid grid-cols-2 gap-2">{classes.map((row) => <label key={row.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${assignmentForm.class_ids.includes(row.id) ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600"}`}><input type="checkbox" checked={assignmentForm.class_ids.includes(row.id)} onChange={() => toggleClass(row.id)} className="accent-emerald-600" /> {row.name}</label>)}</div></fieldset>
              <LoadingButton loading={saving} onClick={saveAssignment} className="mt-5 min-h-11 w-full rounded-lg bg-emerald-600 px-4 font-semibold text-white hover:bg-emerald-700">Simpan penugasan</LoadingButton>
            </aside>
            <div className="space-y-4">{grouped.map((group) => (
              <article key={`${group.subject.id}:${group.teacher?.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 transition-transform hover:-translate-y-0.5">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">{group.teacher?.name || "Guru"}</p><h2 className="mt-1 text-lg font-semibold text-slate-900">{group.subject.name}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{group.assignments.length} kelas</span></div>
                <div className="mt-4 flex flex-wrap gap-2">{group.assignments.map((assignment) => <span key={assignment.id} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-800">{assignment.class?.name || assignment.class_id}<button type="button" aria-label={`Hapus kelas ${assignment.class?.name || assignment.class_id}`} onClick={() => removeAssignment(assignment.id)} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-red-100 hover:text-red-700"><FaTrash className="text-xs" /></button></span>)}</div>
              </article>
            ))}</div>
          </section>
        ) : (
          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {grouped.map((group) => <article key={`${group.subject.id}:${group.teacher?.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-transform hover:-translate-y-0.5"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><FaBookOpen /></span><h2 className="mt-4 text-lg font-semibold text-slate-900">{group.subject.name}</h2><p className="mt-1 text-sm text-slate-500">{group.subject.description || "Mata pelajaran aktif"}</p><div className="mt-5 flex flex-wrap gap-2">{group.assignments.map((assignment) => <span key={assignment.id} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">{assignment.class?.name || assignment.class_id}</span>)}</div></article>)}
            {grouped.length === 0 && <p className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">Belum ada penugasan mengajar untuk akun ini.</p>}
          </section>
        )}
      </main>
    </Sidebar>
  );
}
