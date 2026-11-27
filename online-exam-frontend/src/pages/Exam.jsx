import {getUserFromToken} from "../utils/jwtHelper";
import { useState, useEffect, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import SearchBar from "../components/Users/SearchBar";
import ExamTable from "../components/Exams/ExamTable";
import Pagination from "../components/Paginate";
import Swal from "sweetalert2";
import withReactContent from "sweetalert2-react-content";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import CustomDatePicker from "../components/CustomDatePicker";
import ExamTypeSelect from "../components/DropdownExamType";
import { format } from "date-fns";
import { FaClipboardList } from "react-icons/fa";
import api from "../api/axiosConfig";
import LoadingButton from "../components/LoadingButton";

const MySwal = withReactContent(Swal);
const initialExamForm = {
  title: "",
  subject_id: "",
  type: "Reguler",
  date: "",
  duration: 0,
  multiple_choice_weight: 50,
  essay_weight: 50,
  teacher_id: "",
  class_ids: [],
  package_exam_id: "",
  category_id: "",
};
const scoreWeightOptions = [
  { label: "70:30", multipleChoice: 70, essay: 30 },
  { label: "60:40", multipleChoice: 60, essay: 40 },
  { label: "50:50", multipleChoice: 50, essay: 50 },
];

const Exam = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [meta, setMeta] = useState({ total: 0 });
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [categories, setCategories] = useState([]);
  const isAdmin = getUserFromToken()?.role === "ADMIN";
  const search = searchParams.get("search") || "";
  const sort = searchParams.get("sort") || "title";
  const order = searchParams.get("order") || "asc";
  const page = Number(searchParams.get("page")) || 1;
  const pageSize = 10;
  const categoryId = searchParams.get("categoryId") || "";

  const updateParams = (changes) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === "") next.delete(key);
      else next.set(key, String(value));
    });
    setSearchParams(next);
  };

  const fetchCategories = async () => {
    try {
      const { data } = await api.get("/exam-categories");
      setCategories(Array.isArray(data) ? data : []);
    } catch {
      MySwal.fire("Gagal!", "Gagal mengambil kategori ujian.", "error");
    }
  };

  const createCategory = async () => {
    const result = await MySwal.fire({
      title: "Tambah kategori ujian",
      input: "text",
      inputLabel: "Nama kategori",
      inputPlaceholder: "Contoh: ATS Ganjil 2026–2027",
      showCancelButton: true,
      confirmButtonText: "Simpan",
      cancelButtonText: "Batal",
      inputValidator: (value) => !value.trim() ? "Nama kategori wajib diisi." : undefined,
    });
    if (!result.isConfirmed) return;
    try {
      const { data } = await api.post("/exam-categories", { name: result.value });
      await fetchCategories();
      updateParams({ categoryId: data.id, page: "1" });
      MySwal.fire("Berhasil!", "Kategori ujian ditambahkan.", "success");
    } catch (error) {
      MySwal.fire("Gagal!", error.response?.data?.message || "Gagal menambah kategori ujian.", "error");
    }
  };

  const renameCategory = async () => {
    const chosen = categories.find((item) => item.id === categoryId);
    if (!chosen) return;
    const result = await MySwal.fire({
      title: "Ubah nama kategori",
      input: "text",
      inputValue: chosen.name,
      showCancelButton: true,
      confirmButtonText: "Simpan",
      cancelButtonText: "Batal",
      inputValidator: (value) => !value.trim() ? "Nama kategori wajib diisi." : undefined,
    });
    if (!result.isConfirmed) return;
    try {
      await api.put(`/exam-categories/${chosen.id}`, { name: result.value });
      await fetchCategories();
      fetchExams();
      MySwal.fire("Berhasil!", "Nama kategori diperbarui.", "success");
    } catch (error) {
      MySwal.fire("Gagal!", error.response?.data?.message || "Gagal mengubah kategori ujian.", "error");
    }
  };

  const [formData, setFormData] = useState(initialExamForm);
  const resetForm = () => setFormData(initialExamForm);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDateChange = (date) => {
    const formatted = format(date, "yyyy-MM-dd");
    setFormData((prev) => ({ ...prev, date: formatted }));
  };

  const handleScoreWeightChange = (value) => {
    const option = scoreWeightOptions.find((item) => item.label === value) || scoreWeightOptions[2];
    setFormData((prev) => ({
      ...prev,
      multiple_choice_weight: option.multipleChoice,
      essay_weight: option.essay,
    }));
  };

  const fetchExams = async () => {
    setLoading(true);
    try {
      const res = await api.get("/exams", {
        params: { search, sort, order, page, limit: pageSize, categoryId },
      });
      const rows = Array.isArray(res.data?.data) ? res.data.data : [];
      if (getUserFromToken()?.role === "ADMIN") {
        const withTokens = await Promise.all(rows.map(async (exam) => {
          if (Object.hasOwn(exam, "token")) return exam;
          try {
            const { data } = await api.get(`/exams/${exam.id}/control`);
            return { ...exam, token: data?.token ?? null };
          } catch {
            return { ...exam, token: null, tokenLoadError: true };
          }
        }));
        setExams(withTokens);
      } else {
        setExams(rows);
      }
      setMeta(res.data?.meta || { total: 0 });
    } catch {
      MySwal.fire({
        title: "Error",
        text: "Gagal mengambil data ujian.",
        icon: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExams();
  }, [search, sort, order, page, categoryId]);

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    api.get("/teaching-assignments")
      .then((response) => setAssignments(response.data?.data || []))
      .catch(() => setAssignments([]));
  }, []);

  const teacherId = getUserFromToken()?.role === "GURU" ? getUserFromToken()?.sub : formData.teacher_id;
  const teacherOptions = Array.from(new Map(assignments.map((item) => {
    const teacher = Array.isArray(item.teacher) ? item.teacher[0] : item.teacher;
    return [item.teacher_id, teacher];
  })).entries()).filter(([, teacher]) => teacher);
  const subjectOptions = Array.from(new Map(assignments
    .filter((item) => !teacherId || item.teacher_id === teacherId)
    .map((item) => {
      const subject = Array.isArray(item.subject) ? item.subject[0] : item.subject;
      return [item.subject_id, subject];
    })).entries()).filter(([, subject]) => subject);
  const classOptions = assignments
    .filter((item) => item.teacher_id === teacherId && item.subject_id === formData.subject_id)
    .map((item) => ({ id: item.class_id, ...(Array.isArray(item.class) ? item.class[0] : item.class) }));

  const handleSubmit = async () => {
    if (saving) return;
    if (!formData.title || !formData.subject_id || !formData.type || !formData.date || !formData.duration || !teacherId || formData.class_ids.length === 0 || !formData.category_id) {
      MySwal.fire("Gagal!", "Lengkapi kategori, judul, guru, mapel, kelas, jenis, tanggal, dan durasi.", "error");
      return;
    }

    try {
      setSaving(true);
      await api.post("/exams", { ...formData, teacher_id: teacherId, package_exam_id: formData.package_exam_id || undefined }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      setShowModal(false);
      resetForm();
      MySwal.fire({
        title: "Berhasil!",
        text: `Ujian berhasil ditambahkan.`,
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
      fetchExams();
    } catch (err) {
      const msg = err.response?.data?.message || "Tidak dapat menambah ujian.";
      MySwal.fire({
        title: "Gagal!",
        text: msg,
        icon: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (id) => {
    try {
      const res = await api.get(`/exams/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const exam = res.data;
      if (exam) {
        setFormData({
          title: exam.title,
          subject_id: exam.subject_id,
          type: exam.type,
          date: exam.date,
          duration: exam.duration,
          multiple_choice_weight: Number(exam.multiple_choice_weight ?? 50),
          essay_weight: Number(exam.essay_weight ?? 50),
          teacher_id: exam.assigned_teacher_id || "",
          class_ids: (exam.target_classes || []).map((target) => target.class_id),
          package_exam_id: exam.package_exam_id || "",
          category_id: exam.category_id || "",
        });
        setSelectedId(exam.id);
        setEditModalOpen(true);
      }
    } catch {
      MySwal.fire({
        title: "Error",
        text: "Gagal mengambil data ujian untuk diedit.",
        icon: "error",
      });
    }
  };

  const handleUpdate = async () => {
    if (updating) return;
    if (!formData.title || !formData.subject_id || !formData.type || !formData.date || !formData.duration) {
      MySwal.fire("Gagal!", "Silakan lengkapi semua isian wajib!", "error");
      return;
    }

    try {
      setUpdating(true);
      await api.put(
        `/exams/${selectedId}`,
        { ...formData, category_id: formData.category_id || undefined },
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );
      setEditModalOpen(false);
      resetForm();
      MySwal.fire({
        title: "Berhasil!",
        text: "Ujian berhasil diperbarui.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
      fetchExams();
    } catch (err) {
      const msg = err.response?.data?.message || "Tidak dapat memperbarui ujian.";
      MySwal.fire({
        title: "Gagal!",
        text: msg,
        icon: "error",
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async (id) => {
    if (deletingId) return;
    const result = await MySwal.fire({
      title: "Hapus ujian?",
      text: "Ujian akan disembunyikan dari daftar aktif.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Hapus",
      cancelButtonText: "Batal",
    });

    if (!result.isConfirmed) return;

    try {
      setDeletingId(id);
      await api.delete(`/exams/${id}`);
      MySwal.fire("Berhasil!", "Ujian berhasil dihapus.", "success");
      fetchExams();
    } catch (err) {
      const msg = err.response?.data?.message || "Tidak dapat menghapus ujian.";
      MySwal.fire("Gagal!", msg, "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Sidebar>
      <div className="module-shell">
        {/* Header */}
        <div className="module-header">
          <div className="module-title-wrap">
            <div className="module-icon">
              <FaClipboardList className="text-lg" />
            </div>
            <h3 className="module-title">Daftar Ujian</h3>
          </div>
          <button
            onClick={() => {
              setFormData({ ...initialExamForm, category_id: categories.some((item) => item.id === categoryId) ? categoryId : "", teacher_id: getUserFromToken()?.role === "GURU" ? getUserFromToken()?.sub || "" : "" });
              setShowModal(true);
            }}
            className="module-action-btn bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white transition-all"
          >
            + Tambah Ujian
          </button>
        </div>

        {/* Table Section */}
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
          <div className="flex flex-wrap items-start gap-3">
            <SearchBar value={search} />
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="exam-category-filter" className="text-sm font-medium text-slate-600">Kategori</label>
              <select id="exam-category-filter" value={categoryId} onChange={(event) => updateParams({ categoryId: event.target.value, page: "1" })} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none">
                <option value="">Semua kategori</option>
                <option value="uncategorized">Belum dikategorikan</option>
                {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {isAdmin && <button type="button" onClick={createCategory} className="min-h-10 rounded-lg border border-emerald-200 px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50">+ Kategori</button>}
              {isAdmin && categories.some((item) => item.id === categoryId) && <button type="button" onClick={renameCategory} className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Ubah nama</button>}
            </div>
          </div>

          {loading ? (
            <div className="mt-6 animate-pulse space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-6 bg-gray-200 rounded"></div>
              ))}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <ExamTable
                  data={exams}
                  onRefresh={fetchExams}
                  searchParams={searchParams}
                  setSearchParams={setSearchParams}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              </div>

              <div className="flex items-center justify-between mt-6">
                <div className="text-sm text-gray-500">
                  {meta.total > 0 && (
                    <span>
                      Menampilkan{" "}
                      <strong>{(page - 1) * pageSize + 1}</strong> -{" "}
                      <strong>{Math.min(page * pageSize, meta.total)}</strong>{" "}
                      dari <strong>{meta.total}</strong> ujian
                    </span>
                  )}
                </div>
                <Pagination
                  current={page}
                  total={meta.total}
                  pageSize={pageSize}
                  onPageChange={(p) =>
                    updateParams({ page: p.toString() })
                  }
                />
              </div>
            </>
          )}
        </div>

        {/* Modal Tambah/Edit */}
        <Transition appear show={showModal || editModalOpen} as={Fragment}>
          <Dialog
            as="div"
            className="relative z-10"
            onClose={() => {
              setShowModal(false);
              setEditModalOpen(false);
              resetForm();
            }}
          >
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
              <div className="flex min-h-full items-center justify-center p-4 text-center">
                <TransitionChild
                  as={Fragment}
                  enter="ease-out duration-300"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="ease-in duration-200"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                >
                  <DialogPanel className="w-full max-w-2xl transform rounded-2xl bg-white p-6 text-left align-middle shadow-2xl border border-gray-200 transition-all">
                    <DialogTitle
                      as="h3"
                      className="text-xl font-semibold text-gray-800 mb-4"
                    >
                      {showModal ? "Tambah Ujian Baru" : "Edit Ujian"}
                    </DialogTitle>

                    <div className="space-y-4">
                      <div>
                        <label htmlFor="exam-category-field" className="block text-sm font-medium text-gray-700">Kategori Ujian</label>
                        <select id="exam-category-field" value={formData.category_id} onChange={(event) => setFormData((prev) => ({ ...prev, category_id: event.target.value }))} className="min-h-11 w-full rounded-lg border border-gray-300 px-3">
                          <option value="">{showModal ? "Pilih kategori" : "Belum dikategorikan (ujian lama)"}</option>
                          {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        {showModal && categories.length === 0 && <p className="mt-1 text-xs text-amber-700">{isAdmin ? "Buat kategori terlebih dahulu." : "Minta admin membuat kategori ujian terlebih dahulu."}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Judul Ujian
                        </label>
                        <input
                          type="text"
                          name="title"
                          value={formData.title}
                          onChange={handleInputChange}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                        />
                      </div>

                      <CustomDatePicker
                        label="Tanggal Ujian"
                        selectedDate={formData.date}
                        onChange={handleDateChange}
                      />

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Jenis Ujian
                        </label>
                        <div className="border border-gray-300 rounded-lg">
                          <ExamTypeSelect
                            type={formData.type}
                            setType={(value) =>
                              setFormData((prev) => ({ ...prev, type: value }))
                            }
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Durasi (menit)
                        </label>
                        <input
                          type="number"
                          name="duration"
                          value={formData.duration}
                          onChange={handleInputChange}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Bobot Nilai PG : Essay
                        </label>
                        <select
                          value={`${formData.multiple_choice_weight}:${formData.essay_weight}`}
                          onChange={(e) => handleScoreWeightChange(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                        >
                          {scoreWeightOptions.map((option) => (
                            <option key={option.label} value={option.label}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                          Angka depan adalah bobot Pilihan Ganda, angka belakang adalah bobot Essay.
                        </p>
                      </div>

                      {showModal && getUserFromToken()?.role === "ADMIN" && <div>
                        <label className="block text-sm font-medium text-gray-700">Guru pengampu</label>
                        <select value={formData.teacher_id} onChange={(event) => setFormData((prev) => ({ ...prev, teacher_id: event.target.value, subject_id: "", class_ids: [], package_exam_id: "" }))} className="min-h-11 w-full rounded-lg border border-gray-300 px-3">
                          <option value="">Pilih guru</option>
                          {teacherOptions.map(([id, teacher]) => <option key={id} value={id}>{teacher.name}</option>)}
                        </select>
                      </div>}

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Mata Pelajaran
                        </label>
                        <select value={formData.subject_id} disabled={!showModal || !teacherId} onChange={(event) => setFormData((prev) => ({ ...prev, subject_id: event.target.value, class_ids: [], package_exam_id: "" }))} className="min-h-11 w-full rounded-lg border border-gray-300 px-3 disabled:bg-slate-100">
                          <option value="">Pilih mapel dari penugasan</option>
                          {subjectOptions.map(([id, subject]) => <option key={id} value={id}>{subject.name}</option>)}
                        </select>
                      </div>

                      {showModal && <fieldset>
                        <legend className="block text-sm font-medium text-gray-700">Kelas peserta</legend>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {classOptions.map((classRow) => <label key={classRow.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${formData.class_ids.includes(classRow.id) ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200"}`}><input type="checkbox" checked={formData.class_ids.includes(classRow.id)} onChange={() => setFormData((prev) => ({ ...prev, class_ids: prev.class_ids.includes(classRow.id) ? prev.class_ids.filter((id) => id !== classRow.id) : [...prev.class_ids, classRow.id] }))} className="accent-emerald-600" />{classRow.name || classRow.id}</label>)}
                        </div>
                        {formData.subject_id && classOptions.length === 0 && <p className="mt-2 text-sm text-amber-700">Belum ada kelas pada penugasan ini.</p>}
                      </fieldset>}

                      {showModal && <div>
                        <label className="block text-sm font-medium text-gray-700">Gunakan paket soal (opsional)</label>
                        <select value={formData.package_exam_id} onChange={(event) => setFormData((prev) => ({ ...prev, package_exam_id: event.target.value }))} className="min-h-11 w-full rounded-lg border border-gray-300 px-3">
                          <option value="">Buat paket soal baru</option>
                          {exams.filter((exam) => exam.subject_id === formData.subject_id && exam.assigned_teacher_id === teacherId).map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
                        </select>
                        <p className="mt-1 text-xs text-slate-500">Pilih ujian lama bila sesi ini memakai soal yang sama.</p>
                      </div>}
                    </div>

                    <div className="mt-6 flex justify-end space-x-3">
                      <button
                        onClick={() => {
                          setShowModal(false);
                          setEditModalOpen(false);
                          resetForm();
                        }}
                        disabled={saving || updating}
                        className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg"
                      >
                        Batal
                      </button>
                      <LoadingButton
                        onClick={showModal ? handleSubmit : handleUpdate}
                        loading={showModal ? saving : updating}
                        loadingText={showModal ? "Menyimpan..." : "Memperbarui..."}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg"
                      >
                        {showModal ? "Simpan" : "Perbarui"}
                      </LoadingButton>
                    </div>
                  </DialogPanel>
                </TransitionChild>
              </div>
            </div>
          </Dialog>
        </Transition>
      </div>
    </Sidebar>
  );
};

export default Exam;
