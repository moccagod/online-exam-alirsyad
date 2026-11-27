import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { FaDownload, FaFileExcel, FaUpload } from "react-icons/fa";
import api from "../../api/axiosConfig";
import RichTextRenderer from "../RichTextRenderer";

function downloadTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Tipe", "Pertanyaan", "A", "B", "C", "D", "E", "Kunci"],
    ["PG", "Berapa hasil 2 + 3?", "3", "4", "5", "6", "", "C"],
    ["Esai", "Jelaskan fungsi sistem operasi.", "", "", "", "", "", "Mengelola sumber daya komputer."],
  ]);
  sheet["!cols"] = [12, 48, 22, 22, 22, 22, 22, 42].map((wch) => ({ wch }));
  const instructions = XLSX.utils.aoa_to_sheet([
    ["Petunjuk pengisian template soal"],
    ["Jangan ubah nama atau urutan kolom pada lembar Soal."],
    ["Isi Tipe dengan PG atau Esai. Untuk PG, isi minimal dua pilihan dan Kunci dengan huruf A–E."],
    ["Untuk Esai, kolom A–E boleh kosong dan Kunci berisi panduan jawaban."],
    ["Tempel gambar PNG/JPEG di dalam satu sel pada kolom Pertanyaan atau A–E di baris soal yang sama."],
    ["Maksimal satu gambar per sel dan 2 MB per gambar. Teks pada sel boleh tetap diisi."],
    ["Pastikan gambar tidak melintasi batas sel. Ukuran berkas Excel maksimal 20 MB."],
    ["Baris contoh pada lembar Soal boleh dihapus sebelum diunggah."],
  ]);
  instructions["!cols"] = [{ wch: 105 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Soal");
  XLSX.utils.book_append_sheet(book, instructions, "Petunjuk");
  XLSX.writeFile(book, "template_soal_ujian.xlsx");
}

export default function PackageTools({ examId, onChange }) {
  const path = `/exams/${examId}/questionnaires`;
  const [packages, setPackages] = useState({ choices: [], selected: examId });
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [linking, setLinking] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingPackages(true);
    api.get(`${path}/packages`)
      .then(({ data }) => { if (active) setPackages(data); })
      .catch((err) => { if (active) setError(err.userMessage || "Paket soal gagal dimuat."); })
      .finally(() => { if (active) setLoadingPackages(false); });
    return () => { active = false; };
  }, [path]);

  async function link(source) {
    setLinking(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.post(`${path}/package`, { source });
      setPackages((previous) => ({ ...previous, selected: data.selected }));
      setPreview(null);
      setFile(null);
      setMessage(source === examId ? "Paket sesi ini digunakan." : "Paket soal berhasil dipilih.");
      onChange();
    } catch (err) {
      setError(err.userMessage || "Paket soal gagal diubah.");
    } finally {
      setLinking(false);
    }
  }

  async function upload(chosen, save) {
    if (!chosen) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", chosen);
      const { data } = await api.post(`${path}/import?save=${Number(save)}`, form);
      if (save && data.errors.length === 0) {
        setPreview(null);
        setFile(null);
        setMessage(`${data.rows.length} soal berhasil diimpor.`);
        onChange();
      } else {
        setPreview(data);
        if (data.errors.length) setError("Perbaiki kesalahan pada berkas, lalu unggah kembali.");
      }
    } catch (err) {
      setError(err.userMessage || "Berkas soal gagal diproses.");
    } finally {
      setBusy(false);
    }
  }

  function chooseFile(event) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    setFile(null);
    setPreview(null);
    setMessage("");
    setError("");
    if (!chosen) return;
    if (!chosen.name.toLowerCase().endsWith(".xlsx")) {
      setError("Pilih berkas Excel dengan ekstensi .xlsx.");
      return;
    }
    if (chosen.size > 20 * 1024 * 1024) {
      setError("Ukuran berkas maksimal 20 MB.");
      return;
    }
    setFile(chosen);
    upload(chosen, false);
  }

  const selected = packages.selected || examId;
  const selectedTitle = packages.choices.find((choice) => choice.id === selected)?.title;

  return (
    <section aria-label="Paket dan impor soal" className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 sm:p-5">
      <div className="mb-4">
        <h4 className="text-base font-semibold text-slate-900">Paket soal dan impor Excel</h4>
        <p className="mt-1 text-sm text-slate-600">Pilih sumber soal untuk sesi ini, atau unggah soal dari template Excel.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <label htmlFor="question-package" className="block text-sm font-semibold text-slate-800">Sumber paket soal</label>
          <select id="question-package" value={selected} disabled={loadingPackages || linking} onChange={(event) => link(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60">
            <option value={examId}>Paket sesi ini</option>
            {packages.choices.filter((choice) => choice.id !== examId).map((choice) => (
              <option key={choice.id} value={choice.id}>{choice.title}</option>
            ))}
          </select>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            {loadingPackages ? "Memuat paket soal..." : linking ? "Menyimpan pilihan paket..." : selected === examId
              ? "Soal yang ditambah atau diimpor tersimpan untuk sesi ini."
              : `Sesi ini memakai soal dari ${selectedTitle || "paket terpilih"}. Soal yang diimpor juga masuk ke paket tersebut.`}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">Impor soal dari Excel</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">Unduh template, isi soal, lalu unggah berkas .xlsx (maksimal 20 MB). Periksa pratinjau sebelum menyimpan.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={downloadTemplate} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-emerald-600 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <FaDownload aria-hidden="true" /> Unduh template
            </button>
            <label className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus-within:ring-2 focus-within:ring-emerald-500 ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
              <FaUpload aria-hidden="true" /> Unggah template
              <input type="file" accept=".xlsx" disabled={busy} onChange={chooseFile} className="sr-only" aria-label="Pilih berkas template soal Excel" />
            </label>
          </div>
          {file && <p className="mt-3 flex items-center gap-2 break-all text-xs text-slate-600"><FaFileExcel aria-hidden="true" /> {file.name}{busy ? " — memeriksa..." : ""}</p>}
        </div>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-800">{message}</p>}
      {preview && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h5 className="font-semibold text-slate-900">Pratinjau impor</h5>
              <p className="text-sm text-slate-600">{preview.rows.length} soal ditemukan · {preview.errors.length} kesalahan</p>
            </div>
            <button type="button" disabled={busy || preview.errors.length > 0 || preview.rows.length === 0} onClick={() => upload(file, true)}
              className="min-h-11 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-300">
              {busy ? "Menyimpan..." : `Simpan ${preview.rows.length} soal`}
            </button>
          </div>
          {preview.errors.length > 0 && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"><p className="font-semibold">Kesalahan dalam berkas</p><ul className="mt-1 list-disc pl-5">{preview.errors.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
          <div className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1">
            {preview.rows.map((row) => (
              <div key={row.index} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Baris Excel {row.index} · {row.type === "multiple_choice" ? "Pilihan ganda" : "Esai"}</p>
                <RichTextRenderer content={row.question} />
                {row.options.map((option, index) => <div key={index} className="mt-2 flex gap-2 rounded-md bg-slate-50 p-2"><span className="font-semibold text-slate-600">{String.fromCharCode(65 + index)}.</span><RichTextRenderer content={option} /></div>)}
                <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-600">
                  <span className="font-semibold">Jawaban benar:</span> <RichTextRenderer content={row.answer} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
