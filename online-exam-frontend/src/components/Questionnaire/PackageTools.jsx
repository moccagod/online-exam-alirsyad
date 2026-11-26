import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import api from "../../api/axiosConfig";

function downloadTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Tipe", "Pertanyaan", "A", "B", "C", "D", "E", "Kunci"],
    ["PG", "Berapa hasil 2 + 3?", "3", "4", "5", "6", "", "C"],
    [
      "Esai",
      "Jelaskan fungsi sistem operasi.",
      "",
      "",
      "",
      "",
      "",
      "Mengelola sumber daya komputer.",
    ],
  ]);
  sheet["!cols"] = [10, 44, 18, 18, 18, 18, 18, 40].map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Soal");
  XLSX.writeFile(book, "Template soal.xlsx");
}

export default function PackageTools({ examId, onChange }) {
  const path = "/exams/" + examId + "/questionnaires";
  const [packages, setPackages] = useState({ choices: [] });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api
      .get(path + "/packages")
      .then((r) => setPackages(r.data))
      .catch(() => setMessage("Paket gagal dimuat"));
  }, [path]);
  async function link(source) {
    try {
      await api.post(path + "/package", { source });
      setPackages({ ...packages, selected: source });
      onChange();
    } catch (e) {
      setMessage(e.userMessage);
    }
  }
  async function upload(chosen, save) {
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", chosen);
      const { data } = await api.post(
        path + "/import?save=" + Number(save),
        form,
      );
      if (save && !data.errors.length) {
        setPreview(null);
        setFile(null);
        setMessage("Impor tersimpan");
        onChange();
      } else setPreview(data);
    } catch (e) {
      setMessage(e.userMessage);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl bg-white p-4">
      <label>
        Paket soal{" "}
        <select
          value={packages.selected || examId}
          onChange={(e) => link(e.target.value)}
        >
          <option value={examId}>Paket sesi ini</option>
          {packages.choices
            .filter((x) => x.id !== examId)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-4">
        <button onClick={downloadTemplate}>Unduh template Excel</button>
        <label>
          Impor .xlsx{" "}
          <input
            disabled={busy}
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const chosen = e.target.files[0];
              setFile(chosen);
              setPreview(null);
              if (chosen) upload(chosen, false);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {preview && (
        <div className="max-h-64 overflow-auto">
          {preview.errors.map((msg) => (
            <p className="text-red-700" key={msg}>
              {msg}
            </p>
          ))}
          {preview.rows.map((row) => (
            <p key={row.index}>
              Baris {row.index} | {row.question} | {row.options.join(" / ")} |
              Kunci {row.answer}
            </p>
          ))}
          <button
            disabled={busy || preview.errors.length > 0}
            onClick={() => upload(file, true)}
          >
            Simpan seluruh impor
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
